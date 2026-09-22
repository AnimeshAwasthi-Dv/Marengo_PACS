import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function ServiceUsageChart({ data }: { data: Record<string, string | number>[] }) { return (<ResponsiveContainer height="100%" width="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="studies"
                fill="#0ea5e9"
                name="Studies"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="credits"
                fill="#14b8a6"
                name="Credits"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="failures"
                fill="#ef4444"
                name="Failures"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>); }

export function MonthlyNetworkChart({ data }: { data: Record<string, string | number>[] }) { return (<ResponsiveContainer height="100%" width="100%">
            <BarChart data={data}>
              <CartesianGrid
                stroke="#dfe9ee"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Bar
                dataKey="studies"
                fill="#1767ad"
                name="Studies"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="reports"
                fill="#0796a8"
                name="Reports"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>); }

export function ModalityCasesChart({ data }: { data: Record<string, string | number>[] }) { return (<ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="modality" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="received" fill="#2563eb" name="Received" radius={[4, 4, 0, 0]} />
              <Bar dataKey="processing" fill="#f59e0b" name="Processing" radius={[4, 4, 0, 0]} />
              <Bar dataKey="reported" fill="#059669" name="Reported" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>); }

export function NetworkTrendChart({ data }: { data: Record<string, string | number>[] }) { return (<ResponsiveContainer height="100%" width="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Bar
                dataKey="studies"
                fill="#1d5da8"
                name="Studies"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="reports"
                fill="#2aa3a0"
                name="Reports"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>); }