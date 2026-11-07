import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the local API target configurable without relying on ambient Node types.
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,'.','SMTR_');
  const apiTarget=env.SMTR_DEV_API_TARGET||'http://127.0.0.1:4010';
  return {
    base:'/smtr/',
    plugins:[react()],
    server:{
      host:'0.0.0.0',
      proxy:{
        '/smtr/api/v1':{target:apiTarget,changeOrigin:false},
        '/smtr/ws':{target:apiTarget.replace(/^http/,'ws'),ws:true,changeOrigin:false},
      },
    },
    build:{outDir:'dist'},
  };
});
