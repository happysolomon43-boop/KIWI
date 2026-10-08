'use strict';

// PostgreSQL ALTER TABLE ... ADD COLUMN IF NOT EXISTS still obtains an ACCESS
// EXCLUSIVE relation lock, even if the column already exists. KIWI used to
// rerun hundreds of these changes on *every* web-service boot, allowing normal
// user traffic to delay API readiness. Prefer a single read-only catalog check
// before attempting DDL. The catalog is only an optimization: newly missing
// columns still follow the original transactional migration, and an unavailable
// catalog never causes a required migration to be skipped.
function migrationTargets(sql){
  const statement=String(sql).trim();
  const add=/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\b/i.exec(statement);
  if(add)return {kind:'ADD_COLUMN',table:add[1].toLowerCase(),column:add[2].toLowerCase()};
  const drop=/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ALTER\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+DROP\s+NOT\s+NULL\b/i.exec(statement);
  if(drop)return {kind:'DROP_NOT_NULL',table:drop[1].toLowerCase(),column:drop[2].toLowerCase()};
  return null;
}
function selectMissingBootMigrations(migrations,catalogRows){
  if(!Array.isArray(migrations))throw new TypeError('Boot migrations must be an array.');
  if(!Array.isArray(catalogRows))return {pending:migrations.slice(),skipped:0,usedCatalog:false};
  const catalog=new Map();
  for(const row of catalogRows){
    if(typeof row?.table_name!=='string'||typeof row?.column_name!=='string')continue;
    catalog.set(row.table_name.toLowerCase()+'.'+row.column_name.toLowerCase(),row);
  }
  let skipped=0;
  const pending=migrations.filter(sql=>{
    const t=migrationTargets(sql);
    if(!t)return true;
    const existing=catalog.get(t.table+'.'+t.column);
    if(!existing)return true;
    if(t.kind==='ADD_COLUMN'||t.kind==='DROP_NOT_NULL'&&existing.is_nullable==='YES'){
      skipped+=1;return false;
    }
    return true;
  });
  return {pending,skipped,usedCatalog:true};
}
async function planStartupSchemaMigrations(query,migrations){
  const tables=[...new Set(migrations.map(migrationTargets).filter(Boolean).map(t=>t.table))];
  if(!tables.length)return selectMissingBootMigrations(migrations,[]);
  try{
    const result=await query(
      "select table_name,column_name,is_nullable from information_schema.columns where table_schema='public' and table_name=any($1::text[])",
      [tables]
    );
    return selectMissingBootMigrations(migrations,result?.rows);
  }catch{
    return selectMissingBootMigrations(migrations,null);
  }
}
module.exports={migrationTargets,selectMissingBootMigrations,planStartupSchemaMigrations};
