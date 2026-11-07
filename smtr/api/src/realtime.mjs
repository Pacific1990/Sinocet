import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';

export const realtimeBus=new EventEmitter();
realtimeBus.setMaxListeners(200);
const tokenHash=value=>createHash('sha256').update(value).digest('hex');

export function realtimeRoutes(pool){
  const router=Router();
  router.post('/ticket',async(req,res,next)=>{
    try{
      const ticket=randomBytes(32).toString('base64url');
      await pool.query(
        'INSERT INTO realtime_tickets(user_id,ticket_hash,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 45 SECOND))',
        [req.auth.id,tokenHash(ticket)]
      );
      res.set('Cache-Control','no-store');
      res.json({ticket,expiresInSeconds:45});
    }catch(error){next(error);}
  });
  return router;
}

export function attachRealtime(server,pool){
  const wss=new WebSocketServer({noServer:true,maxPayload:1024});
  wss.on('connection',(socket,user)=>{
    socket.alive=true;
    socket.on('pong',()=>{socket.alive=true;});
    socket.send(JSON.stringify({event:'connected',id:user.id,at:new Date().toISOString()}));
  });
  const sendRefresh=event=>{
    const message=JSON.stringify({event:'refresh',at:new Date().toISOString(),resource:event.resource});
    for(const ws of wss.clients){
      if(ws.readyState===WebSocket.OPEN && ws.alive)ws.send(message);
    }
  };
  realtimeBus.on('refresh',sendRefresh);
  const heartbeat=setInterval(()=>{
    for(const ws of wss.clients){
      if(!ws.alive){ws.terminate();continue;}
      ws.alive=false;ws.ping();
    }
  },25000);
  heartbeat.unref?.();

  server.on('upgrade',async(req,socket,head)=>{
    try{
      const baseHost=req.headers.host||'localhost';
      const uri=new URL(req.url||'/', 'http://'+baseHost);
      if(uri.pathname!=='/smtr/ws'){socket.destroy();return;}
      const origin=req.headers.origin||'';
      const expected=process.env.SMTR_ALLOWED_ORIGIN||('http://'+baseHost);
      const allowed=new Set([expected,'https://'+baseHost,'http://'+baseHost]);
      if(!origin||!allowed.has(origin)){socket.destroy();return;}
      const ticket=uri.searchParams.get('ticket');
      if(!ticket||!(/^[A-Za-z0-9_-]{35,64}$/.test(ticket))){socket.destroy();return;}
      const [used]=await pool.query(
        'UPDATE realtime_tickets SET used_at=UTC_TIMESTAMP() WHERE ticket_hash=? '+
        'AND used_at IS NULL AND expires_at>UTC_TIMESTAMP()',
        [tokenHash(ticket)]
      );
      if(used.affectedRows!==1){socket.destroy();return;}
      const [rows]=await pool.query(
        'SELECT rt.user_id AS id FROM realtime_tickets rt '+
        'JOIN users u ON u.id=rt.user_id WHERE rt.ticket_hash=? AND u.active=1',[tokenHash(ticket)]
      );
      if(!rows.length){socket.destroy();return;}
      wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,{id:String(rows[0].id)}));
    }catch{socket.destroy();}
  });
  server.on('close',()=>{
    clearInterval(heartbeat);realtimeBus.off('refresh',sendRefresh);wss.close();
  });
  return wss;
}
