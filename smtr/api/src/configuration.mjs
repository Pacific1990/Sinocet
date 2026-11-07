// Only non-secret, validated application configuration is exposed to clients.
export async function applicationSettings(pool){
  const [rows]=await pool.query('SELECT key_name,CAST(value_json AS CHAR) AS encoded FROM system_settings');
  const values=Object.fromEntries(rows.map(row=>[row.key_name,JSON.parse(row.encoded)]));
  const integer=(key,fallback,min,max)=>Number.isInteger(values[key])&&values[key]>=min&&values[key]<=max?values[key]:fallback;
  return {
    companyName:typeof values['company.name']==='string'?values['company.name']:'Groupe Sinocet Electronics',
    pageSize:integer('ui.page_size',25,10,100),
    transitDays:integer('alerts.transit_days',2,1,90),
    savDays:integer('alerts.sav_days',5,1,180),
  };
}
