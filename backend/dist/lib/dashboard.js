export function formatCurrency(value, currency = 'KES') {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    }).format(value).replace('KES', 'KSH');
}
export function buildDashboardOverview(input) {
    const totalExposure = Number(input.totalExposure ?? 0);
    const outstanding = Number(input.outstanding ?? 0);
    const overdue = Number(input.overdue ?? 0);
    const highRiskEntities = Number(input.highRiskEntities ?? 0);
    const brokenPromises = Number(input.brokenPromises ?? 0);
    const recoveredThisMonth = Number(input.recoveredThisMonth ?? 0);
    const needsAttention = Number(input.needsAttention ?? 0);
    const exposureTrend = Number(input.exposureTrend ?? 0);
    const debtRate = totalExposure > 0 ? (overdue / totalExposure) * 100 : 0;
    const metrics = [
        { label: 'Needs Attention', value: `${needsAttention}`, tone: 'rose' },
        { label: 'Outstanding', value: formatCurrency(outstanding), tone: 'amber' },
        { label: 'Broken PTP', value: `${brokenPromises}`, tone: 'rose' },
        { label: 'High Risk', value: `${highRiskEntities}`, tone: 'sky' },
    ];
    return {
        totalExposure,
        outstanding,
        overdue,
        highRiskEntities,
        brokenPromises,
        recoveredThisMonth,
        needsAttention,
        exposureTrend,
        debtRate,
        metrics,
    };
}
