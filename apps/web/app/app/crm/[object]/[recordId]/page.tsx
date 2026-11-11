import { RecordView } from "../../_components/record-view"

export default async function CrmRecordPage({ params }: { params: Promise<{ object: string; recordId: string }> }) {
  const { object, recordId } = await params
  return <RecordView objectKey={object} recordId={recordId} />
}
