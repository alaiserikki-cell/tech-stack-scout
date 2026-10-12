import "dotenv/config";
import { getDb } from "../src/db/client";
import { sql } from "drizzle-orm";
(async()=>{const r=await getDb().execute(sql.raw(process.argv[2]));console.log(JSON.stringify(r.rows,null,0).slice(0,6000));process.exit(0)})();
