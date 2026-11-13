import { useParams } from 'react-router-dom';
import { useLoad } from '../lib/useLoad';
import { periodLabel } from '../lib/water';
import { BillContent, type BillView } from '../components/BillView';
import { Card, Loading, Notice, PageHeader, PrintButton } from '../components/ui';

/** A water bill on its own page (the pop-up on the customer card shows the same thing). */
export function BillNotice() {
  const { id } = useParams();
  const { data, error, loading } = useLoad<BillView>(`/water/bills/${id}`);

  if (loading && !data) return <Loading what="bill" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;

  return (
    <>
      <PageHeader title="Water Bill" subtitle={periodLabel(data.bill.period)} back={{ to: `/accounts/${data.account.id}`, label: 'Back to account' }}>
        <PrintButton />
      </PageHeader>
      <Card className="max-w-2xl p-7 print:max-w-none print:border-0 print:p-0">
        <BillContent data={data} />
      </Card>
    </>
  );
}
