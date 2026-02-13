import { useState } from 'react';

const PRESETS = [
  { label: 'All time', value: null },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '6mo', value: 180 },
  { label: '1yr', value: 365 },
];

export default function DateFilter({ onFilterChange }) {
  const [activePreset, setActivePreset] = useState(null);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = (days) => {
    setActivePreset(days);
    setShowCustom(false);

    if (days === null) {
      onFilterChange({ startDate: undefined, endDate: undefined });
      return;
    }

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    onFilterChange({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
  };

  const handleCustomApply = () => {
    onFilterChange({
      startDate: customStart ? new Date(customStart).toISOString() : undefined,
      endDate: customEnd ? new Date(customEnd).toISOString() : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider">
        Time Range
      </label>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => handlePreset(p.value)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              activePreset === p.value && !showCustom
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => {
            setShowCustom(!showCustom);
            setActivePreset('custom');
          }}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            showCustom
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="space-y-2 pt-1">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleCustomApply}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-1.5 rounded-md transition-colors"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
