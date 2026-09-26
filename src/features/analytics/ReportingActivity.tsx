import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type ReportingActivityData = {
 daily: {day:string;submitted:number;received:number;sent:number;notSent:number}[];
 hourly: {hour:string;studies:number}[];
 modalityDistribution: {modality:string;count:number;percentage:number}[];
 totals: {submitted:number;received:number;sent:number;notSent:number};
};
export function ReportingActivity({data}: {data: ReportingActivityData}) {
 return <div className="pw-stats-scroll">
  <section className="pw-metric-strip" aria-label="Reporting activity totals">
   <div><span>Sent for reporting</span><strong>{data.totals.submitted}</strong><small>submissions in selected period</small></div>
   <div><span>Studies received</span><strong>{data.totals.received}</strong></div>
   <div><span>Received studies sent</span><strong>{data.totals.sent}</strong><small>by the end of selected period</small></div>
   <div><span>Received studies not sent</span><strong>{data.totals.notSent}</strong><small>by the end of selected period</small></div>
  </section>
  <div className="pw-analytics-grid">
   <section><h2>Reporting Activity - Day Wise</h2><div className="pw-stats-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.daily}><CartesianGrid stroke="#465364" vertical={false}/><XAxis dataKey="day" tick={{fill:'#c3ccd9',fontSize:11}}/><YAxis allowDecimals={false} tick={{fill: '#c3ccd9',fontSize:11}}/><Tooltip contentStyle={{background: '#252d37', color: '#edf2f8', borderColor: '#485465'}}/><Bar dataKey="submitted" name="Sent for reporting" fill="#66c4ac" isAnimationActive={false}/></BarChart></ResponsiveContainer></div></section>
   <section><h2>Reporting Activity - 24 Hours (IST)</h2><div className="pw-stats-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.hourly}><CartesianGrid stroke="#465364" vertical={false}/><XAxis dataKey="hour" interval={3}/><YAxis allowDecimals={false} tick={{fill: '#c3ccd9',fontSize:11}}/><Tooltip contentStyle={{background: '#252d37', color: '#edf2f8', borderColor: '#485465'}}/><Bar dataKey="studies" name="Sent for reporting" fill="#66c4ac" isAnimationActive={false}/></BarChart></ResponsiveContainer></div></section>
   <section><h2>Reporting by Modality</h2><div className="pw-stats-chart">{data.modalityDistribution.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.modalityDistribution}><XAxis dataKey="modality" interval={0} tick={{fontSize:10}}/><YAxis allowDecimals={false} tick={{fill: '#c3ccd9',fontSize:11}}/><Tooltip contentStyle={{background: '#252d37', color: '#edf2f8', borderColor: '#485465'}}/><Bar dataKey="count" name="Sent for reporting" fill="#d8b778" isAnimationActive={false}/></BarChart></ResponsiveContainer> : <div className="pw-empty">No studies sent for reporting in this period.</div>}</div></section>
  </div>
  <section className="pw-tat-chart"><h2>Received vs Sent for Reporting</h2><ResponsiveContainer width="100%" height={300}><BarChart data={data.daily}><CartesianGrid stroke="#465364" vertical={false}/><XAxis dataKey="day"/><YAxis allowDecimals={false} tick={{fill: '#c3ccd9',fontSize:11}}/><Tooltip contentStyle={{background: '#252d37', color: '#edf2f8', borderColor: '#485465'}}/><Legend/><Bar dataKey="received" name="Received" fill="#75a5ef"/><Bar dataKey="sent" name="Sent by period end" stackId="cohort" fill="#66c4ac"/><Bar dataKey="notSent" name="Not sent by period end" stackId="cohort" fill="#d8b778"/></BarChart></ResponsiveContainer><p className="pw-help">Comparison groups studies by received date. Sent and not sent add up to received. Submission activity above also includes studies received before this period. Failed reporting attempts still count as sent.</p></section>
  <table className="pw-data-table pw-daily-table"><thead><tr><th>Date (IST)</th><th>Sent for reporting</th><th>Received</th><th>Received studies sent</th><th>Received studies not sent</th></tr></thead><tbody>{data.daily.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.submitted}</td><td>{d.received}</td><td>{d.sent}</td><td>{d.notSent}</td></tr>)}</tbody></table>
 </div>;
}
