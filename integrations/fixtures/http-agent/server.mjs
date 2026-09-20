import {createServer} from 'node:http';
const server=createServer((req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;if(body.length>65536)req.destroy()});req.on('end',()=>{try{const input=JSON.parse(body).input;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({answer:input}));}catch{res.writeHead(400);res.end()}})});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port})));
