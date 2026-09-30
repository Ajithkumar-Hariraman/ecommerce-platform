import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function startProvider(webhookUrl: string, secret: string, options: {port?:number; databasePath?:string; responseDelay?:number} = {}) {
  const directory = options.databasePath ? undefined : await mkdtemp(join(tmpdir(),"ecommerce-payment-"));
  const databasePath = options.databasePath ?? join(directory!,"payments.sqlite");
  const child = spawn(process.execPath,["../../services/payment-provider-simulator/server.mjs"],{
    env:{...process.env,HOST:"127.0.0.1",PORT:String(options.port??0),PAYMENT_WEBHOOK_URL:webhookUrl,
      PAYMENT_WEBHOOK_SECRET:secret,PAYMENT_DATABASE_PATH:databasePath,PAYMENT_RESPONSE_DELAY_MS:String(options.responseDelay??0)},
    stdio:["ignore","pipe","pipe"],
  });
  const exited = once(child,"exit"); let output="";
  child.stdout!.on("data",data=>{output+=data.toString();});
  child.stderr!.on("data",()=>{});
  const stop = async () => {
    if(child.exitCode!==null)return;
    child.kill("SIGTERM");
    const timer=setTimeout(()=>child.kill("SIGKILL"),6000);
    try {await exited;} finally {clearTimeout(timer);}
  };
  const cleanup = async () => {await stop();if(directory)await rm(directory,{recursive:true,force:true});};
  try {
    for(let i=0;i<100&&!output.includes("Payment provider listening");i++) {
      if(child.exitCode!==null)throw new Error("Payment provider failed to start");await delay(25);
    }
    const port=Number(/Payment provider listening on (\d+)/.exec(output)?.[1]);
    if(!port)throw new Error("Payment provider did not listen");
    return {baseUrl:`http://127.0.0.1:${port}`,port,databasePath,stop,cleanup};
  } catch(error) {await cleanup();throw error;}
}
