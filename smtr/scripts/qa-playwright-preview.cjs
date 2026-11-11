"use strict";
// Navigation Playwright avec aperçus DEV : aucune session, aucun faux résultat métier.
// Pour une recette transactionnelle, utiliser l'API POS et quatre comptes sur DEV.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const BASE=process.env.SMTR_QA_URL||"http://127.0.0.1:5173";
const roles=["admin","director","manager","agent"];
const output=path.resolve(__dirname,"../qa-artifacts");
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const role of roles){
   const context=await browser.newContext({viewport:{width:1440,height:900}});
   const page=await context.newPage();
   await page.goto(BASE+"/?preview="+role,{waitUntil:"networkidle"});
   await page.locator(".preview-banner").waitFor({state:"visible"});
   const entries=await page.locator(".sidebar-navigation .nav-link").allTextContents();
   assert(entries.some(s=>s.includes("Validation QA")),role+": missing QA navigation");
   if(role==="admin"){
     assert(!entries.some(s=>s.trim()==="Produits"),"Admin must not see business products");
   }else{
     assert(entries.some(s=>s.includes("Produits")),role+": missing products");
     assert(entries.some(s=>s.includes("Stocks")),role+": missing stocks");
     assert(entries.some(s=>s.includes("Transferts")),role+": missing transfers");
   }
   await page.locator(".sidebar-navigation button").filter({hasText:"Validation QA"}).first().click();
   await page.locator("h1").filter({hasText:"Recette & validation"}).waitFor();
   await page.locator(".ref-panel").filter({hasText:"Mode aperçu sans données"}).waitFor();
   await page.screenshot({path:path.join(output,role+"-qa-desktop.png"),fullPage:true});
   if(role!=="admin"){
     await page.locator(".sidebar-navigation button").filter({hasText:"Produits"}).first().click();
     await page.locator("h1").filter({hasText:"Catalogue Produits"}).waitFor();
     await page.screenshot({path:path.join(output,role+"-products-desktop.png"),fullPage:true});
   }
   await context.close();

   const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const m=await mobile.newPage();
   await m.goto(BASE+"/?preview="+role,{waitUntil:"networkidle"});
   await m.locator(".mobile-menu-button").click();
   const drawer=m.locator(".mobile-drawer");
   await drawer.getByRole("button",{name:/Validation QA/}).click();
   await m.locator("h1").filter({hasText:"Recette & validation"}).waitFor();
   await m.screenshot({path:path.join(output,role+"-qa-mobile.png"),fullPage:true});
   await mobile.close();
   process.stdout.write("PASS interface aperçu "+role+": menus, QA, desktop/mobile\n");
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
