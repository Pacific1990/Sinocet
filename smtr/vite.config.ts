import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the local API target configurable without relying on ambient Node types.
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,'.','POS_');
  const apiTarget=env.POS_DEV_API_TARGET||'http://127.0.0.1:4020';
  return {
    base:'/smtr/',
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
