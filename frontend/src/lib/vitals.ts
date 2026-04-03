import type { Metric } from 'web-vitals';

function logVital(metric: Metric) {
  const label = {
    CLS: 'Cumulative Layout Shift',
    FCP: 'First Contentful Paint',
    INP: 'Interaction to Next Paint',
    LCP: 'Largest Contentful Paint',
    TTFB: 'Time to First Byte',
  }[metric.name] ?? metric.name;

  // eslint-disable-next-line no-console
  console.log(
    `%c[Vitals] ${label}: ${metric.value.toFixed(metric.name === 'CLS' ? 3 : 0)}${metric.name === 'CLS' ? '' : 'ms'}`,
    'color: #8b5cf6; font-weight: bold',
  );
}

export function reportWebVitals() {
  import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    onCLS(logVital);
    onFCP(logVital);
    onINP(logVital);
    onLCP(logVital);
    onTTFB(logVital);
  });
}
