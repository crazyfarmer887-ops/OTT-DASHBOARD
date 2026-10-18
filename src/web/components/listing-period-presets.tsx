import { LISTING_PERIODS, listingPeriodEnd } from '../lib/listing-period';

export default function ListingPeriodPresets({ startDate, endDate, onChange, maxEndDate, disabled = false }: {
  startDate: string; endDate: string; onChange: (value: string) => void; maxEndDate?: string; disabled?: boolean;
}) {
  return <div className="listing-period-presets" role="group" aria-label="이용 기간 빠른 선택">
    {LISTING_PERIODS.map(period => {
      const end = listingPeriodEnd(startDate, period.months);
      const exceeds = Boolean(maxEndDate && end > maxEndDate);
      return <button key={period.months} type="button" aria-pressed={Boolean(end && endDate === end)}
        disabled={disabled || !end || exceeds} title={exceeds ? `계정 이용 종료일 ${maxEndDate}을 초과합니다.` : undefined}
        onClick={() => onChange(end)}>{period.label}</button>;
    })}
  </div>;
}
