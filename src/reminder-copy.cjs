const {randomInt}=require('node:crypto');
const messages=Object.freeze([
  ...require('./reminder-originals.json'),
  ...require('./reminder-classics.json')
].map(message=>Object.freeze({...message})));
const byId=new Map(messages.map(message=>[message.id,message]));
function normalizeRotation(raw){
  const seen=Array.isArray(raw?.seen)?[...new Set(raw.seen.filter(id=>byId.has(id)))].slice(-messages.length):[];
  const currentId=byId.has(raw?.currentId)?raw.currentId:null;
  if(currentId&&!seen.includes(currentId))seen.push(currentId);
  return {seen:seen.slice(-messages.length),currentId};
}
function getCurrentMessage(raw){return byId.get(raw?.currentId)||messages[0];}
function advanceMessage(raw,chooseIndex=randomInt){
  let {seen,currentId}=normalizeRotation(raw);
  let available=messages.filter(message=>!seen.includes(message.id));
  if(!available.length){
    seen=[];
    available=messages.filter(message=>message.id!==currentId);
  }
  const index=chooseIndex(available.length);
  if(!Number.isInteger(index)||index<0||index>=available.length)throw new Error('Invalid reminder message selection');
  const message=available[index];
  return {message,rotation:{seen:[...seen,message.id],currentId:message.id}};
}
module.exports={messages,normalizeRotation,getCurrentMessage,advanceMessage};
