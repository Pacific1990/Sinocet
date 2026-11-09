import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the local API target configurable without relying on ambient Node types.
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,'.','SMTR_');
  const base=loadEnv(mode,'.','VITE_').VITE_SMTR_BASE_PATH||'/smtr/';
  if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw new Error('VITE_SMTR_BASE_PATH doit être un chemin absolu terminé par /');
  const apiTarget=env.SMTR_DEV_API_TARGET||'http://127.0.0.1:4010';
  return {
    base,
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
