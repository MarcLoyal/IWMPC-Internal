import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { CIVIL_STATUS, ageFrom, peso } from '../lib/format';
import type { AccountProfile, Area, Beneficiary, CivilStatus, Settings } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { BeneficiaryEditor, cleanBeneficiaries } from '../components/BeneficiaryEditor';
import { Card, Field, LinkButton, Loading, Notice, PageHeader, buttonClass } from '../components/ui';

const EMPTY = {
  lastName: '',
  firstName: '',
  middleName: '',
  areaId: '',
  purok: '',
  barangay: 'Inicbulan',
  municipality: 'Bauan',
  province: 'Batangas',
  phone: '',
  birthDate: '',
  sex: '',
  civilStatus: '',
  tin: '',
  religion: '',
  education: '',
  idType: '',
  idNumber: '',
  // Application for Membership
  membershipAppliedOn: '',
  membershipPurpose: '',
  sharesSubscribed: '',
  sharesAmount: '',
  meterRegisteredName: '',
  pmesAttended: '',
  boardDecision: '',
  boardDecisionDate: '',
};

type Form = typeof EMPTY;

const ID_TYPES = [
  'National ID (PhilSys)',
  "Driver's License",
  'Passport',
  "Voter's ID",
  'Senior Citizen ID',
  'UMID',
  'SSS ID',
  'GSIS ID',
  'PhilHealth ID',
  'Pag-IBIG ID',
  'Postal ID',
  'PRC ID',
  'TIN ID',
  'PWD ID',
  'Barangay ID',
  'Other',
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="mt-0.5 text-slate-600">{note}</p>}
      <div className="mt-4 grid gap-5 sm:grid-cols-6">{children}</div>
    </Card>
  );
}

/**
 * One form for "New Account", "Edit", and "Make a Member".
 * The fields follow IWMPC's paper forms. Make a Member shows the whole Application for
 * Membership; whether the account IS a member is only ever changed by paying the fee.
 */
export function AccountForm({ makeMember = false }: { makeMember?: boolean }) {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const areas = useLoad<{ areas: Area[] }>('/areas');
  const existing = useLoad<AccountProfile>(editing ? `/accounts/${id}` : null);
  const settings = useLoad<Settings>(makeMember ? '/settings' : null);

  const [form, setForm] = useState<Form>(EMPTY);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const a = existing.data?.account;
    if (!a) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    setForm({
      lastName: a.lastName,
      firstName: a.firstName,
      middleName: a.middleName,
      areaId: String(a.areaId),
      purok: a.purok,
      barangay: a.barangay,
      municipality: a.municipality,
      province: a.province,
      phone: a.phone,
      birthDate: a.birthDate ?? '',
      sex: a.sex ?? '',
      civilStatus: a.civilStatus ?? '',
      tin: a.tin,
      religion: a.religion,
      education: a.education,
      idType: a.idType,
      idNumber: a.idNumber,
      membershipAppliedOn: a.membershipAppliedOn ?? (makeMember ? today : ''),
      membershipPurpose: a.membershipPurpose,
      sharesSubscribed: a.sharesSubscribed === null ? '' : String(a.sharesSubscribed),
      sharesAmount: a.sharesAmount ?? '',
      meterRegisteredName: a.meterRegisteredName || (makeMember ? a.fullName : ''),
      pmesAttended: a.pmesAttended === null ? '' : a.pmesAttended ? 'yes' : 'no',
      boardDecision: a.boardDecision ?? '',
      boardDecisionDate: a.boardDecisionDate ?? '',
    });
    // The paper form has three beneficiary lines.
    const rows = [...a.beneficiaries];
    while (makeMember && rows.length < 3) rows.push({ name: '', relationship: '' });
    setBeneficiaries(rows);
  }, [existing.data, makeMember]);

  const set = (key: keyof Form) => (e: { target: { value: string } }) => {
    setError('');
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };
  const input = (key: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input" value={form[key]} onChange={set(key)} {...props} />
  );

  const showMembership = makeMember || (editing && existing.data?.account.membershipStatus !== 'NONE');
  const backTo = editing ? `/accounts/${id}` : '/accounts';
  const age = ageFrom(form.birthDate);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.lastName.trim()) return setError('Please type the family name.');
    if (!form.firstName.trim()) return setError('Please type the given name.');
    if (!form.areaId) return setError('Please choose an area.');
    setSaving(true);
    const body = {
      ...form,
      areaId: Number(form.areaId),
      sex: form.sex || null,
      civilStatus: form.civilStatus || null,
      pmesAttended: form.pmesAttended === '' ? null : form.pmesAttended === 'yes',
      boardDecision: form.boardDecision || null,
      ...(showMembership ? { beneficiaries: cleanBeneficiaries(beneficiaries) } : {}),
    };
    try {
      if (makeMember) {
        await api.post(`/accounts/${id}/make-member`, body);
        navigate(`/accounts/${id}`);
      } else if (editing) {
        await api.put(`/accounts/${id}`, body);
        navigate(`/accounts/${id}`);
      } else {
        const created = await api.post<{ id: number }>('/accounts', body);
        navigate(`/accounts/${created.id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
      window.scrollTo({ top: document.body.scrollHeight });
    }
  }

  if (editing && existing.loading && !existing.data) return <Loading />;
  if (editing && existing.error) return <Notice tone="error">{existing.error}</Notice>;

  const name = existing.data?.account.fullName ?? 'Account';

  return (
    <>
      <PageHeader
        title={makeMember ? 'Make a Member' : editing ? `Edit ${name}` : 'New Account'}
        subtitle={
          makeMember
            ? `Application for Membership of ${name}. Fill this in from the paper form.`
            : editing
              ? undefined
              : 'For a new water applicant. The account number is given automatically when you save.'
        }
        back={{ to: backTo, label: editing ? 'Back to account' : 'Back to Accounts' }}
      />
      <form onSubmit={submit} className="max-w-4xl space-y-5">
        <Section title="Name">
          <Field label="Family name" className="sm:col-span-2">
            {input('lastName', { placeholder: 'e.g. Dela Cruz', autoFocus: !editing })}
          </Field>
          <Field label="Given name" className="sm:col-span-2">
            {input('firstName', { placeholder: 'e.g. Juan' })}
          </Field>
          <Field label="Middle name" className="sm:col-span-2">
            {input('middleName')}
          </Field>
        </Section>

        <Section title="Address">
          <Field label="Purok / Sitio" className="sm:col-span-3">
            {input('purok')}
          </Field>
          <Field label="Barangay" className="sm:col-span-3">
            {input('barangay')}
          </Field>
          <Field label="Municipality" className="sm:col-span-2">
            {input('municipality')}
          </Field>
          <Field label="Province" className="sm:col-span-2">
            {input('province')}
          </Field>
          <Field label="Area" hint="Used for meter reading and lists." className="sm:col-span-2">
            <select className="input" value={form.areaId} onChange={set('areaId')}>
              <option value="">Choose an area…</option>
              {areas.data?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Personal Details" note={makeMember ? 'Birthday, sex and civil status are needed for membership.' : undefined}>
          <Field label="Birthday" hint={age !== null ? `Age: ${age}` : undefined} className="sm:col-span-2">
            {input('birthDate', { type: 'date' })}
          </Field>
          <Field label="Sex" className="sm:col-span-2">
            <select className="input" value={form.sex} onChange={set('sex')}>
              <option value="">Choose…</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </Field>
          <Field label="Civil status" className="sm:col-span-2">
            <select className="input" value={form.civilStatus} onChange={set('civilStatus')}>
              <option value="">Choose…</option>
              {(Object.keys(CIVIL_STATUS) as CivilStatus[]).map((c) => (
                <option key={c} value={c}>
                  {CIVIL_STATUS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact number" className="sm:col-span-2">
            {input('phone', { inputMode: 'tel' })}
          </Field>
          <Field label="TIN (optional)" className="sm:col-span-2">
            {input('tin')}
          </Field>
          <Field label="Religion" className="sm:col-span-2">
            {input('religion')}
          </Field>
          <Field label="Highest educational attainment" className="sm:col-span-6">
            {input('education')}
          </Field>
          <Field label="ID type" className="sm:col-span-3">
            <select className="input" value={form.idType} onChange={set('idType')}>
              <option value="">Choose…</option>
              {/* An ID typed in before this list existed is kept as it is. */}
              {form.idType && !ID_TYPES.includes(form.idType) && <option value={form.idType}>{form.idType}</option>}
              {ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ID number" className="sm:col-span-3">
            {input('idNumber')}
          </Field>
        </Section>

        {showMembership && (
          <>
            <Section title="Application for Membership">
              <Field label="Date of application" className="sm:col-span-2">
                {input('membershipAppliedOn', { type: 'date' })}
              </Field>
              <Field label="Purpose/s for membership" className="sm:col-span-4">
                {input('membershipPurpose')}
              </Field>
              <Field label="Subscribed share capital: number of shares" className="sm:col-span-3">
                {input('sharesSubscribed', { inputMode: 'numeric', className: 'input tabular-nums' })}
              </Field>
              <Field label="Subscribed share capital: amount (₱)" className="sm:col-span-3">
                {input('sharesAmount', { inputMode: 'decimal', className: 'input tabular-nums' })}
              </Field>
              <div className="sm:col-span-6">
                <BeneficiaryEditor value={beneficiaries} onChange={setBeneficiaries} />
              </div>
            </Section>

            <Section title="For IWMPC Use">
              <Field label="Registered name of household water meter" className="sm:col-span-6">
                {input('meterRegisteredName')}
              </Field>
              <Field label="Attended PMES?" hint="Pre-Membership Education Seminar" className="sm:col-span-2">
                <select className="input" value={form.pmesAttended} onChange={set('pmesAttended')}>
                  <option value="">Not yet recorded</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
              <Field label="Board decision" className="sm:col-span-2">
                <select className="input" value={form.boardDecision} onChange={set('boardDecision')}>
                  <option value="">Not yet decided</option>
                  <option value="APPROVED">Approved</option>
                  <option value="DISAPPROVED">Disapproved</option>
                </select>
              </Field>
              <Field label="Date of board decision" className="sm:col-span-2">
                {input('boardDecisionDate', { type: 'date', disabled: !form.boardDecision })}
              </Field>
              <p className="text-slate-600 sm:col-span-6">
                The <strong>membership fee</strong>
                {settings.data && <> ({peso(settings.data.membership_fee)})</>} and the <strong>initial paid-up capital</strong> are
                received at the Cashier, each with its own OR number. They then show on this account automatically.
              </p>
            </Section>
          </>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className={buttonClass(makeMember ? 'success' : 'primary')}>
            {saving ? 'Saving…' : makeMember ? 'Save Application' : editing ? 'Save Changes' : 'Save Account'}
          </button>
          <LinkButton to={backTo}>Cancel</LinkButton>
        </div>
      </form>
    </>
  );
}
