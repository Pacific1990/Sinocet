import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode})=>{
  const env=loadEnv(mode,'.','POS_');
  const base=loadEnv(mode,'.','VITE_').VITE_SMTR_BASE_PATH||'/smtr/';
  if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw new Error('VITE_SMTR_BASE_PATH must be an absolute subpath ending in /');
  const apiTarget=env.POS_DEV_API_TARGET||'http://127.0.0.1:4020';
  return {
    base,
    plugins:[react()],
    server:{
      host:'0.0.0.0',
      proxy:{
        '/ekolabs/pos/api/v1':{target:apiTarget,changeOrigin:false},
        '/ekolabs/pos/ws':{target:apiTarget.replace(/^http/,'ws'),ws:true,changeOrigin:false},
      },
    },
    build:{outDir:'dist'},
  };
});
