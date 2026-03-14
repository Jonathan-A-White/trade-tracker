interface DateRangePreset {
  label: string;
  start: Date;
  end: Date;
}

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (start: Date, end: Date) => void;
  presets?: DateRangePreset[];
}

function toInputValue(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  presets,
}: DateRangePickerProps) {
  function handleStartChange(value: string) {
    const newStart = new Date(value + "T00:00:00");
    onChange(newStart, endDate);
  }

  function handleEndChange(value: string) {
    const newEnd = new Date(value + "T23:59:59");
    onChange(startDate, newEnd);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label htmlFor="range-start" className="block text-xs font-medium text-gray-500 mb-1">
            From
          </label>
          <input
            id="range-start"
            type="date"
            value={toInputValue(startDate)}
            onChange={(e) => handleStartChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="range-end" className="block text-xs font-medium text-gray-500 mb-1">
            To
          </label>
          <input
            id="range-end"
            type="date"
            value={toInputValue(endDate)}
            onChange={(e) => handleEndChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.start, preset.end)}
              className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
