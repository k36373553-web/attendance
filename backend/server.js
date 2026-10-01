require('dotenv').config();
const express=require('express'),mongoose=require('mongoose'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),cors=require('cors'),helmet=require('helmet'),rl=require('express-rate-limit');
const app=express();app.set('trust proxy',1);
const CLIENT_URL=process.env.CLIENT_URL||'https://attendance-3cor.vercel.app';
const FACE_URL=(process.env.FACE_URL||'https://attendance-rose-tau.vercel.app').replace(/\/$/,'');
const allowedClientOrigins=new Set(CLIENT_URL.split(',').map(origin=>origin.trim().replace(/\/$/,'')).filter(Boolean));
const isVercelPreview=origin=>/^https:\/\/attendance-3cor-[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/i.test(origin);
app.use(helmet(),cors({origin:(origin,callback)=>callback(null,!origin||allowedClientOrigins.has(origin)||isVercelPreview(origin))}),express.json({limit:'15mb'}),rl({windowMs:60000,max:150}));
const S=mongoose.Schema,ID=S.Types.ObjectId;
const User=mongoose.model('User',new S({name:String,designation:String,phone:String,email:{type:String,unique:true},password:String,role:{type:String,default:'employee'},enabled:{type:Boolean,default:true},embeddings:{type:[[Number]],select:false},mean:{type:[Number],select:false}}));
const AS=new S({user:{type:ID,ref:'User'},date:String,checkIn:Date,checkOut:Date,status:String,lateMin:{type:Number,default:0}});AS.index({user:1,date:1},{unique:true});
const Att=mongoose.model('Att',AS);
const Hol=mongoose.model('Hol',new S({date:{type:String,unique:true}}));
const Log=mongoose.model('Log',new S({user:ID,type:String,result:String,at:{type:Date,default:Date.now}}));
const Cfg=mongoose.model('Cfg',new S({cutoff:{type:Number,default:585},checkoutFrom:{type:Number,default:780},halfAfter:{type:Number,default:820},halfOutBefore:{type:Number,default:900},threshold:{type:Number,default:0.45},ips:[String],logo:String}));
const cfg=async()=>(await Cfg.findOne())||Cfg.create({});
const ist=(d=new Date)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,min:+p.hour*60+ +p.minute}};
const ah=fn=>(q,s,n)=>fn(q,s,n).catch(e=>s.status(e.statusCode||500).json({error:e.message}));
const auth=role=>(q,s,n)=>{try{q.u=jwt.verify((q.headers.authorization||'').slice(7),process.env.JWT_SECRET);if(q.u.type==='r'||role&&q.u.role!==role)return s.status(403).json({error:'Forbidden'});n()}catch{s.status(401).json({error:'Unauthorized'})}};
const ip2n=i=>i.split('.').reduce((a,x)=>a*256+ +x,0);
const inCidr=(ip,c)=>{const[b,m='32']=c.split('/');if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip)||!/^\d+\.\d+\.\d+\.\d+$/.test(b))return ip===b;const sh=2**(32-+m);return Math.floor(ip2n(ip)/sh)===Math.floor(ip2n(b)/sh)};
const privateIp=ip=>ip==='::1'||ip.startsWith('127.')||ip.startsWith('10.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)||/^(fc|fd|fe80:)/i.test(ip);
let publicIpCache={ip:'',expires:0};
const getPublicIp=async()=>{if(publicIpCache.expires>Date.now())return publicIpCache.ip;const r=await fetch('https://api.ipify.org',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Public IP lookup failed');const ip=(await r.text()).trim();if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))throw new Error('Invalid public IP response');publicIpCache={ip,expires:Date.now()+60000};return ip};
const officeOnly=async(q,s,n)=>{const c=await cfg();const list=[...(process.env.ALLOWED_OFFICE_IPS||'').split(','),...c.ips].map(x=>x.trim()).filter(Boolean);
 let ip=(q.ip||'').replace('::ffff:','');if(list.length&&privateIp(ip)){try{ip=await getPublicIp()}catch{return s.status(503).json({error:'NETWORK_CHECK',message:'Could not verify this network. Try again shortly.'})}}if(list.length&&!list.some(x=>inCidr(ip,x)))return s.status(403).json({error:'WIFI',message:'Attendance is limited to the registered office network.'});n()};
const faceRequest=async(path,body)=>{
 const r=await fetch(FACE_URL+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data;try{data=await r.json()}catch{const e=new Error(`Face service returned a non-JSON response (HTTP ${r.status})`);e.statusCode=502;throw e}
 if(!r.ok){const e=new Error(data.error||`Face service request failed (HTTP ${r.status})`);e.statusCode=502;throw e}
 return data;
};
const embed=async image=>faceRequest('/embed',{image});
const cos=(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]**2;y+=b[i]**2}return d/Math.sqrt(x*y)};
const tok=u=>jwt.sign({id:u._id,role:u.role},process.env.JWT_SECRET,{expiresIn:'15m'});

app.post('/api/auth/login',ah(async(q,s)=>{const u=await User.findOne({email:q.body.email});
 if(!u||!(await bcrypt.compare(q.body.password||'',u.password)))return s.status(401).json({error:'Invalid credentials'});
 if(!u.enabled)return s.status(403).json({error:'Login disabled by admin'});
 s.json({token:tok(u),refresh:jwt.sign({id:u._id,type:'r'},process.env.JWT_SECRET,{expiresIn:'7d'}),user:{id:u._id,name:u.name,designation:u.designation,role:u.role}})}));
app.post('/api/auth/password',auth(),ah(async(q,s)=>{const u=await User.findById(q.u.id);u.password=await bcrypt.hash(q.body.password,10);await u.save();s.json({ok:1})}));

app.post('/api/employees',auth('admin'),ah(async(q,s)=>{const{name,designation,phone,email,password='Growthora2026',images=[]}=q.body;
 if(!name||!email||!Array.isArray(images)||images.length<3||images.length>5)return s.status(400).json({error:'Name, email and 3-5 photos required'});
 const embs=[],rejectedPhotos=[];for(const [i,im] of images.entries()){const r=await embed(im);if(r.error||!Array.isArray(r.embedding)){rejectedPhotos.push(`Photo ${i+1}: ${r.error||'No face embedding returned'}`);continue}embs.push(r.embedding)}
 if(embs.length<3)return s.status(422).json({error:`Only ${embs.length} of ${images.length} photos passed face checks; at least 3 valid photos are required.`,rejectedPhotos});
 const mean=embs[0].map((_,i)=>embs.reduce((a,e)=>a+e[i],0)/embs.length),c=await cfg();
 for(const o of await User.find({role:'employee'}).select('+mean name'))if(o.mean.length&&cos(mean,o.mean)>=c.threshold)return s.status(409).json({error:`Face already registered for ${o.name}`});
 const u=await User.create({name,designation,phone,email,password:await bcrypt.hash(password||'Growthora2026',10),embeddings:embs,mean});s.json({id:u._id,acceptedPhotos:embs.length,rejectedPhotos})}));
app.get('/api/employees',auth('admin'),ah(async(q,s)=>s.json(await User.find({role:'employee'}))));
app.patch('/api/employees/:id/toggle',auth('admin'),ah(async(q,s)=>{const u=await User.findById(q.params.id);u.enabled=!u.enabled;await u.save();s.json({enabled:u.enabled})}));

app.post('/api/attendance/:type',auth('employee'),officeOnly,ah(async(q,s)=>{
 const type=q.params.type,c=await cfg(),t=ist(),me=await User.findById(q.u.id).select('+mean');
 if(!['checkin','checkout'].includes(type))return s.status(400).json({error:'Bad type'});
 if(!me.enabled)return s.status(403).json({error:'Disabled'});
 const fail=async m=>{await Log.create({user:me._id,type,result:m});s.status(400).json({error:m})};
 if((await Hol.findOne({date:t.date})))return s.status(400).json({error:'Today is a holiday'});
 if(type==='checkout'&&t.min<c.checkoutFrom)return s.status(400).json({error:'Check-out unlocks at 1:00 PM'});
 const r=await verify(q.body.frames||[]);if(r.error)return fail(r.error);
 const all=await User.find({role:'employee',enabled:true}).select('+mean');
 let best=null,bs=-1;for(const u of all){if(!u.mean.length)continue;const v=cos(r.embedding,u.mean);if(v>bs){bs=v;best=u}}
 if(!best||bs<c.threshold||String(best._id)!==String(me._id))return fail('Unknown face / attendance not marked');
 let a=await Att.findOne({user:me._id,date:t.date});
 if(type==='checkin'){if(a)return s.status(400).json({error:'Already checked in'});
  const late=Math.max(0,t.min-c.cutoff);a=await Att.create({user:me._id,date:t.date,checkIn:new Date(),lateMin:late,status:t.min>=c.halfAfter?'Half Day':late>0?'Late':'Present'});if(late>0)clients.forEach(x=>x.write('data: '+JSON.stringify({name:me.name,late})+'\n\n'));}
 else{if(!a)return s.status(400).json({error:'No check-in today'});if(a.checkOut)return s.status(400).json({error:'Already checked out'});
  a.checkOut=new Date();if(t.min<=c.halfOutBefore&&a.status!=='Half Day')a.status='Half Day';await a.save();}
 await Log.create({user:me._id,type,result:'success'});s.json({ok:1,at:new Date(),status:a.status})}));
app.get('/api/attendance/mine',auth(),ah(async(q,s)=>s.json(await Att.find({user:q.u.id}).sort('-date'))));
app.get('/api/attendance/summary',auth('admin'),ah(async(q,s)=>{const t=ist().date,{from=t,to=t}=q.query;
 const rows=await Att.find({date:{$gte:from,$lte:to}}).populate('user','name');const total=await User.countDocuments({role:'employee',enabled:true});
 const late=rows.filter(r=>r.lateMin>0),top={},daily={};
 rows.forEach(r=>{const x=daily[r.date]=daily[r.date]||{date:r.date.slice(5),late:0,onTime:0};if(r.lateMin>0){x.late++;const k=r.user?.name;top[k]=top[k]||{name:k,days:0,mins:0};top[k].days++;top[k].mins+=r.lateMin}else x.onTime++});
 const days=new Set(rows.map(r=>r.date)).size||1,mins=rows.map(r=>ist(r.checkIn).min),tl=Object.values(top).sort((a,b)=>b.days-a.days).map(x=>({...x,avg:Math.round(x.mins/x.days)}));
 s.json({total,present:rows.length,late,onTime:rows.filter(r=>!r.lateMin),half:rows.filter(r=>r.status==='Half Day').length,absent:Math.max(0,total*days-rows.length),checkedIn:rows.filter(r=>!r.checkOut).length,pct:Math.round(rows.length/(total*days||1)*100),avg:mins.length?Math.round(mins.reduce((a,b)=>a+b,0)/mins.length):null,holiday:!!(await Hol.findOne({date:t})),topLate:tl,daily:Object.values(daily).sort((a,b)=>a.date>b.date?1:-1)})}));
app.patch('/api/attendance/:id',auth('admin'),ah(async(q,s)=>{if(!['Half Day','Present'].includes(q.body.status))return s.status(400).json({error:'Invalid'});s.json(await Att.findByIdAndUpdate(q.params.id,{status:q.body.status},{new:true}))}));
app.post('/api/holidays',auth('admin'),ah(async(q,s)=>s.json(await Hol.findOneAndUpdate({date:q.body.date},{date:q.body.date},{upsert:true,new:true}))));
app.delete('/api/holidays/:date',auth('admin'),ah(async(q,s)=>{await Hol.deleteOne({date:q.params.date});s.json({ok:1})}));
app.get('/api/settings',auth('admin'),ah(async(q,s)=>s.json(await cfg())));
app.put('/api/settings',auth('admin'),ah(async(q,s)=>{const c=await cfg();Object.assign(c,q.body);await c.save();s.json(c)}));
const clients=new Set();
const verify=async frames=>faceRequest('/verify',{frames});
const hist=async(uid,from,to)=>{const u=await User.findById(uid),born=u._id.getTimestamp().toISOString().slice(0,10),today=ist().date;
 const rows=await Att.find({user:uid,date:{$gte:from,$lte:to}}),hol=new Set((await Hol.find({date:{$gte:from,$lte:to}})).map(h=>h.date)),A=Object.fromEntries(rows.map(r=>[r.date,r]));
 const st={present:0,half:0,leave:0,absent:0,late:0},out=[];
 for(let d=new Date(from+'T00:00:00Z');;d=new Date(+d+864e5)){const k=d.toISOString().slice(0,10);if(k>to)break;if(d.getUTCDay()===0||k<born)continue;
  if(hol.has(k)){out.push({date:k,status:'Holiday'});continue}const a=A[k];
  if(!a){if(k<today){st.leave++;out.push({date:k,status:'Leave'})}continue}
  let status=a.status;if(!a.checkOut&&k<today){status='Absent';st.absent++}else if(a.status==='Half Day')st.half++;else st.present++;if(a.lateMin>0)st.late++;
  out.push({_id:a._id,date:k,checkIn:a.checkIn,checkOut:a.checkOut,lateMin:a.lateMin,status,hours:a.checkOut?+((a.checkOut-a.checkIn)/36e5).toFixed(1):null})}
 return{st,rows:out.reverse()}};
app.get('/api/attendance/history',auth(),ah(async(q,s)=>s.json(await hist(q.u.id,q.query.from,q.query.to))));
app.get('/api/employees/:id/history',auth('admin'),ah(async(q,s)=>s.json(await hist(q.params.id,q.query.from,q.query.to))));
app.get('/api/public',ah(async(q,s)=>s.json({logo:(await cfg()).logo||null})));
app.post('/api/auth/refresh',ah(async(q,s)=>{try{const p=jwt.verify(q.body.refresh,process.env.JWT_SECRET);if(p.type!=='r')throw 0;const u=await User.findById(p.id);if(!u||!u.enabled)throw 0;s.json({token:tok(u)})}catch{s.status(401).json({error:'Session expired'})}}));
app.get('/api/notifications/stream',(q,s)=>{try{if(jwt.verify(q.query.t,process.env.JWT_SECRET).role!=='admin')throw 0}catch{return s.sendStatus(401)}
 s.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});s.flushHeaders();clients.add(s);q.on('close',()=>clients.delete(s))});
mongoose.connect(process.env.MONGO_URI).then(()=>app.listen(process.env.PORT||5000,()=>console.log(`API :${process.env.PORT||5000}`)));
