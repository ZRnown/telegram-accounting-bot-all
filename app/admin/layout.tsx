import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession } from '@/app/api/_auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const sess = cookieStore.get('adm_sess')?.value || null
  const s = verifySession(sess)
  if (!s?.u) {
    redirect('/')
  }
  return (
    <div>
      {children}
    </div>
  )
}
