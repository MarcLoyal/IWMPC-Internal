import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { CIVIL_STATUS } from '../lib/format';
import type { AccountProfile, Area, Beneficiary, CivilStatus } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { BeneficiaryEditor, cleanBeneficiaries } from '../components/BeneficiaryEditor';
import { Card, Field, LinkButton, Loading, Notice, PageHeader, buttonClass } from '../components/ui';

const EMPTY = {
  fullName: '',
  areaId: '',
  address: '',
  phone: '',
  birthDate: '',
  civilStatus: '' as CivilStatus | '',
  idType: '',
  idNumber: '',
};

/** One form for both "New Account" and "Edit". Membership is never changed here. */
export function AccountForm() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const areas = useLoad<{ areas: Area[] }>('/areas');
  const existing = useLoad<AccountProfile>(editing ? `/accounts/${id}` : null);

  const [form, setForm] = useState(EMPTY);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const a = existing.data?.account;
    if (!a) return;
    setForm({
      fullName: a.fullName,
      areaId: String(a.areaId),
      address: a.address,
      phone: a.phone,
      birthDate: a.birthDate ?? '',
      civilStatus: a.civilStatus ?? '',
      idType: a.idType,
      idNumber: a.idNumber,
    });
    setBeneficiaries(a.beneficiaries);
  }, [existing.data]);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const showBeneficiaries = editing && existing.data?.account.membershipStatus !== 'NONE';
  const backTo = editing ? `/accounts/${id}` : '/accounts';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.fullName.trim()) return setError('Please type the full name.');
    if (!form.areaId) return setError('Please choose an area.');
    setSaving(true);
    const body = {
      ...form,
      areaId: Number(form.areaId),
      civilStatus: form.civilStatus || null,
      ...(showBeneficiaries ? { beneficiaries: cleanBeneficiaries(beneficiaries) } : {}),
    };
    try {
      if (editing) {
        await api.put(`/accounts/${id}`, body);
        navigate(`/accounts/${id}`);
      } else {
        const created = await api.post<{ id: number }>('/accounts', body);
        navigate(`/accounts/${created.id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  if (editing && existing.loading && !existing.data) return <Loading />;
  if (editing && existing.error) return <Notice tone="error">{existing.error}</Notice>;

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${existing.data?.account.fullName ?? 'Account'}` : 'New Account'}
        subtitle={editing ? undefined : 'The account number is given automatically when you save.'}
        back={{ to: backTo, label: editing ? 'Back to account' : 'Back to Accounts' }}
      />
      <form onSubmit={submit}>
        <Card className="max-w-3xl p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Full name" className="sm:col-span-2">
              <input className="input" value={form.fullName} onChange={set('fullName')} placeholder="e.g. Juan Dela Cruz" autoFocus={!editing} />
            </Field>
            <Field label="Area">
              <select className="input" value={form.areaId} onChange={set('areaId')}>
                <option value="">Choose an area…</option>
                {areas.data?.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Contact number">
              <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <input className="input" value={form.address} onChange={set('address')} />
            </Field>
            <Field label="Birthday">
              <input className="input" type="date" value={form.birthDate} onChange={set('birthDate')} />
            </Field>
            <Field label="Civil status">
              <select className="input" value={form.civilStatus} onChange={set('civilStatus')}>
                <option value="">Choose…</option>
                {(Object.keys(CIVIL_STATUS) as CivilStatus[]).map((c) => (
                  <option key={c} value={c}>
                    {CIVIL_STATUS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ID type" hint="e.g. Voter's ID, Senior Citizen ID">
              <input className="input" value={form.idType} onChange={set('idType')} />
            </Field>
            <Field label="ID number">
              <input className="input" value={form.idNumber} onChange={set('idNumber')} />
            </Field>
            {showBeneficiaries && (
              <div className="sm:col-span-2">
                <BeneficiaryEditor value={beneficiaries} onChange={setBeneficiaries} />
              </div>
            )}
          </div>

          {error && (
            <Notice tone="error" className="mt-5">
              {error}
            </Notice>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className={buttonClass('primary')}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Account'}
            </button>
            <LinkButton to={backTo}>Cancel</LinkButton>
          </div>
        </Card>
      </form>
    </>
  );
}
