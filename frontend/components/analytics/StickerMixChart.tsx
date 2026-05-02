"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { StickerMixItem } from "@/lib/hooks/useAnalytics";

const COLORS = [
  "#2563EB", "#7C3AED", "#059669", "#DC2626", "#D97706",
  "#0891B2", "#C026D3", "#65A30D",
];

type Props = { items: StickerMixItem[] };

export function StickerMixChart({ items }: Props) {
  const data = items.map((item) => ({
    name: item.slug,
    value: item.count,
    percent: item.percent,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [`${value} uses`, name]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
