import type { Beneficiary } from '../lib/types';
import { Button } from './ui';

export function BeneficiaryEditor({ value, onChange }: { value: Beneficiary[]; onChange: (next: Beneficiary[]) => void }) {
  const update = (i: number, patch: Partial<Beneficiary>) => onChange(value.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  return (
    <div>
      <div className="label">Beneficiaries</div>
      <div className="space-y-2">
        {value.map((b, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input className="input" placeholder="Full name" aria-label={`Beneficiary ${i + 1} name`} value={b.name} onChange={(e) => update(i, { name: e.target.value })} />
            <input
              className="input"
              placeholder="Relationship (e.g. Spouse)"
              aria-label={`Beneficiary ${i + 1} relationship`}
              value={b.relationship}
              onChange={(e) => update(i, { relationship: e.target.value })}
            />
            <Button onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label={`Remove beneficiary ${i + 1}`}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      {value.length < 10 && (
        <Button className="mt-2" onClick={() => onChange([...value, { name: '', relationship: '' }])}>
          + Add Beneficiary
        </Button>
      )}
    </div>
  );
}

/** Drops empty rows before saving. */
export function cleanBeneficiaries(list: Beneficiary[]): Beneficiary[] {
  return list
    .map((b) => ({ name: b.name.trim(), relationship: b.relationship.trim() }))
    .filter((b) => b.name);
}
