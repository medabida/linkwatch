import type { DashboardTarget } from "@linkwatch/shared";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type LineRow, targetName } from "../../lib/dashboard.js";
import { Card, Empty } from "./Card.js";
import { AXIS, CHART_HEIGHT, GRID, TOOLTIP } from "./chartTheme.js";

export interface LineMetricChartProps {
  title: string;
  hint?: string;
  data: LineRow[];
  targets: DashboardTarget[];
  colors: Record<string, string>;
  unit: string;
  decimals?: number;
  tick: (t: number) => string;
  /** Draws the previous period dashed (columns suffixed with ":prev"). */
  compare?: boolean;
  /** Shaded min..max band, only meaningful for a single target. */
  band?: boolean;
}

export function LineMetricChart({ title, hint, data, targets, colors, unit, decimals = 1, tick, compare, band }: LineMetricChartProps) {
  const hasData = data.some((r) => Object.keys(r).some((k) => k !== "t" && k !== "bandLow" && k !== "bandSpan" && r[k] != null));
  const fmt = (v: unknown) => (typeof v === "number" ? `${v.toFixed(decimals)} ${unit}` : "—");
  return (
    <Card title={title} hint={hint}>
      {!hasData ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="t" tickFormatter={tick} {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} width={48} unit={unit.length <= 2 ? unit : ""} />
            <Tooltip {...TOOLTIP} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={fmt} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {band && (
              <Area
                dataKey="bandLow"
                stackId="band"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
                legendType="none"
                tooltipType="none"
              />
            )}
            {band && (
              <Area
                dataKey="bandSpan"
                stackId="band"
                stroke="none"
                fill="#4aa3ff"
                fillOpacity={0.14}
                isAnimationActive={false}
                legendType="none"
                tooltipType="none"
              />
            )}
            {targets.map((t) => (
              <Line
                key={t.key}
                dataKey={t.key}
                name={targetName(t, targets)}
                stroke={colors[t.key]}
                dot={false}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {compare &&
              targets.map((t) => (
                <Line
                  key={`${t.key}:prev`}
                  dataKey={`${t.key}:prev`}
                  name={`${targetName(t, targets)} (previous)`}
                  stroke={colors[t.key]}
                  strokeDasharray="4 4"
                  strokeOpacity={0.55}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
