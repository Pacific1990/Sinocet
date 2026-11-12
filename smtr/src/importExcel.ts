import { authenticatedFetch } from './posTransport';

export type ImportPreview = {
  rows:number; validCount:number; invalidCount:number; totalUnits:number;
  canImport:boolean;
  lines:Array<{row:number;sku:string;action:string;error:string}>;
};
export async function uploadExcel(token:string,path:string,file:File,warehouseId?:string) {
  if(!/\.xlsx$/i.test(file.name)||file.size>2097152)throw new Error('Sélectionnez un .xlsx de 2 Mo maximum.');
  const form=new FormData();
  form.set('file',file);
  if(warehouseId)form.set('warehouseId',warehouseId);
  const res=await authenticatedFetch(path,token,{method:'POST',body:form});
  const json=await res.json();
  if(!res.ok||!json.success)throw new Error(json.message||'Import Excel impossible.');
  return json.data as {preview?:ImportPreview;import?:{quantity:number;skuCount?:number}};
}
export async function downloadExcelTemplate(token:string){
  const res=await authenticatedFetch('/catalog/template',token);
  if(!res.ok)throw new Error('Impossible de télécharger le modèle Excel.');
  const url=URL.createObjectURL(await res.blob());
  try{
    const link=document.createElement('a');
    link.href=url;link.download='modele-smtr-produits-stock.xlsx';
    document.body.appendChild(link);link.click();link.remove();
  }finally{URL.revokeObjectURL(url);}
}
