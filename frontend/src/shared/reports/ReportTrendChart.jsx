import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const ReportTrendChart = ({ data = [] }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <h3 className="text-sm font-semibold text-slate-800 mb-2">Movement Trend</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="incomingUnits" stroke="#10b981" strokeWidth={2} />
            <Line type="monotone" dataKey="outgoingUnits" stroke="#ef4444" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ReportTrendChart;
