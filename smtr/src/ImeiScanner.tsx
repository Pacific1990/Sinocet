import { useEffect, useRef, useState } from 'react';
import { ScanLine, X } from 'lucide-react';

type BarcodeResult={rawValue:string};
type BarcodeDetectorLike={detect:(source:HTMLVideoElement)=>Promise<BarcodeResult[]>};
type BarcodeCtor={new(options:{formats:string[]}):BarcodeDetectorLike};
type Props={onScan:(imei:string)=>void;disabled?:boolean};

function detectorAvailable(){
  return typeof window!=='undefined' && 'BarcodeDetector' in window &&
    typeof (window as unknown as {BarcodeDetector?:unknown}).BarcodeDetector==='function';
}
function normalizeImei(raw:string):string|null{
  const value=raw.trim();
  // Never accept arbitrary URL parts; take only a clean, 15-16-digit IMEI.
  const matches=value.match(/(?<!\d)\d{15,16}(?!\d)/g)||[];
  return matches.length===1?matches[0]:null;
}
export default function ImeiScanner({onScan,disabled=false}:Props){
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const [scanning,setScanning]=useState(false);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const onScanRef=useRef(onScan);
  onScanRef.current=onScan;

  useEffect(()=>{
    if(!open)return;
    let mounted=true;
    let stream:MediaStream|null=null;
    let frame=0;
    let busy=false;
    async function activate(){
      try{
        if(!detectorAvailable()||!navigator.mediaDevices?.getUserMedia){
          setError('Scanner caméra indisponible ici. Saisissez ou collez l’IMEI dans le champ de recherche.');
          return;
        }
        const Detector=(window as unknown as {BarcodeDetector:BarcodeCtor}).BarcodeDetector;
        const detector=new Detector({formats:['qr_code','code_128','code_39','data_matrix']});
        stream=await navigator.mediaDevices.getUserMedia({
          audio:false,video:{facingMode:{ideal:'environment'}}
        });
        if(!mounted){stream.getTracks().forEach(track=>track.stop());return;}
        const video=videoRef.current;
        if(!video)return;
        video.srcObject=stream;
        await video.play();
        if(!mounted)return;
        setScanning(true);
        async function scan(){
          if(!mounted)return;
          if(!busy && video && video.readyState>=2){
            busy=true;
            try{
              const found=await detector.detect(video);
              for(const barcode of found){
                const imei=normalizeImei(barcode.rawValue);
                if(imei){
                  onScanRef.current(imei);
                  setOpen(false);
                  return;
                }
              }
            }catch{/* Skip unreadable frame and retry */ }
            finally{busy=false;}
          }
          if(mounted)frame=requestAnimationFrame(()=>{void scan();});
        }
        void scan();
      }catch{
        if(mounted)setError('Impossible d’ouvrir la caméra. Autorisez son utilisation ou saisissez l’IMEI.');
      }
    }
    void activate();
    return()=>{
      mounted=false;cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track=>track.stop());
      if(videoRef.current)videoRef.current.srcObject=null;
      setScanning(false);
    };
  },[open]);

  return <>
    <button type="button" className="ref-button ref-button--outline" disabled={disabled}
      title="Scanner IMEI ou QR" onClick={()=>{setError('');setOpen(x=>!x);}}>
      <ScanLine size={16}/>{open?'Arrêter':'Scanner IMEI / QR'}
    </button>
    {open&&<div className="catalog-qr" role="region" aria-label="Lecture IMEI par caméra">
      <div className="catalog-row">
        <strong>{scanning?'Présentez le code dans le cadre':'Initialisation de la caméra…'}</strong>
        <button type="button" aria-label="Fermer le scanner" onClick={()=>setOpen(false)}
          className="ref-button ref-button--outline"><X size={17}/></button>
      </div>
      {error?<p className="catalog-note" role="alert">{error}</p>:
        <video ref={videoRef} muted playsInline autoPlay aria-label="Flux de la caméra arrière"/>}
      <p className="catalog-note">Seuls les codes contenant un IMEI à 15 ou 16 chiffres sont acceptés. Aucune image n’est envoyée au serveur.</p>
    </div>}
  </>;
}
