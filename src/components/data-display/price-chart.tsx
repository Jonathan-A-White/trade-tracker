import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface PriceDataPoint {
  date: Date;
  price: number;
  storeName: string;
}

interface PriceChartProps {
  data: PriceDataPoint[];
  storeFilter?: string;
  height?: number;
}

export function PriceChart({ data, storeFilter, height = 250 }: PriceChartProps) {
  const filtered = storeFilter
    ? data.filter((d) => d.storeName === storeFilter)
    : data;

  const chartData = filtered
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((d) => ({
      date: d.date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      price: d.price,
      storeName: d.storeName,
    }));

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-gray-400 text-sm"
        style={{ height }}
      >
        No price data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          stroke="#9ca3af"
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          tick={{ fontSize: 12 }}
          stroke="#9ca3af"
          width={60}
        />
        <Tooltip
          formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]}
          labelStyle={{ color: "#374151" }}
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            fontSize: "14px",
          }}
        />
        <Line
          type="monotone"
          dataKey="price"
          stroke="#2563eb"
          strokeWidth={2}
          dot={{ fill: "#2563eb", r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
