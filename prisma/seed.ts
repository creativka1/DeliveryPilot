import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
async function seed(){
  await db.business.upsert({where:{id:'warehouse'},update:{},create:{id:'warehouse',name:'Northstar Retail Warehouse',timezone:'Asia/Tashkent'}});
  for(const [id,name] of [['entrance-a','Entrance A'],['entrance-b','Entrance B']])await db.location.upsert({where:{id},update:{},create:{id,name,businessId:'warehouse'}});
  for(const [id,name,role,locations] of [['manager','Morgan Lee','MANAGER',['entrance-a','entrance-b']],['alex','Alex','RECEIVER',['entrance-a']],['sam','Sam','RECEIVER',['entrance-a']],['jordan','Jordan','RECEIVER',['entrance-b']]] as const){await db.employee.upsert({where:{id},update:{},create:{id,name,role,businessId:'warehouse',locations:{create:locations.map(locationId=>({locationId}))}}});}
  for(const [id,name,locationId] of [['test-a','Entrance A · test camera','entrance-a'],['test-b','Entrance B · test camera','entrance-b']])await db.cameraDevice.upsert({where:{id},update:{},create:{id,externalId:id,name,locationId,businessId:'warehouse',source:'LOCAL_TEST'}});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const [id,supplier,reference,start,end,locationId,employeeId,notes] of [['northline','Northline Supplies','PO-1042','14:00','15:00','entrance-a','alex','12 cartons · stock replenishment'],['eastpoint','Eastpoint Wholesale','PO-1043','16:00','17:00','entrance-a','sam','Receiving bay access required'],['meridian','Meridian Office Goods','PO-1044','13:00','14:00','entrance-b','jordan','Check contents against the packing list']]){
    const existing=await db.expectedDelivery.findUnique({where:{id}});if(!existing){await db.expectedDelivery.create({data:{id,businessId:'warehouse',supplier,reference,windowStart:new Date(`${date}T${start}:00+05:00`),windowEnd:new Date(`${date}T${end}:00+05:00`),locationId,employeeId,notes}});await db.auditLog.create({data:{businessId:'warehouse',actorId:'seed',actorName:'Demo setup',action:'DELIVERY_CREATED',source:'DEMO_SEED',deliveryId:id,message:`Expected delivery created: ${supplier}. Seeded schedule; no arrival or receipt has been recorded.`}});}
  }
}
seed().finally(()=>db.$disconnect());
