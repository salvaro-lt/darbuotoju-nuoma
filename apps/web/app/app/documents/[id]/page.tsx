import { DocumentView } from "../_components/document-view"

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DocumentView documentId={id} />
}
