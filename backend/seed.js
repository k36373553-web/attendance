require('dotenv').config();const m=require('mongoose'),b=require('bcryptjs');
(async()=>{await m.connect(process.env.MONGO_URI);const U=m.connection.collection('users');
await U.updateOne({email:process.env.ADMIN_EMAIL},{$set:{name:'Admin',email:process.env.ADMIN_EMAIL,password:await b.hash(process.env.ADMIN_PASSWORD,10),role:'admin',enabled:true}},{upsert:true});console.log('admin ready');process.exit()})();
