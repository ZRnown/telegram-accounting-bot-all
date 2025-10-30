// Enhanced Excel export: prefer .xlsx (SheetJS) with multiple sheets; fallback to CSV

type SummaryData = {
  totalIncome: number
  totalIncomeUSDT: number
  totalDispatch: number
  totalDispatchUSDT: number
  totalBills: number
  averageRate: number
  averageFee: number
  notDispatched: number
  notDispatchedUSDT: number
}

type TxItem = {
  id: string
  type: 'income' | 'dispatch'
  amount: number
  usdt: number | null
  rate: number | null
  replier: string | null
  operator: string | null
  createdAt: string
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function exportToExcel(date: Date, chatId?: string) {
  const day = ymd(date)
  const from = `${day}`
  const toDate = new Date(date)
  toDate.setDate(toDate.getDate() + 1)
  const to = ymd(toDate)

  // Load real data
  const summaryUrl = `/api/stats/today?date=${encodeURIComponent(day)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`
  const txIncomeUrl = `/api/transactions?type=income&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}&size=1000`
  const txDispatchUrl = `/api/transactions?type=dispatch&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}&size=1000`

  let summary: SummaryData | null = null
  let incomes: TxItem[] = []
  let dispatches: TxItem[] = []
  try {
    const [s, inc, dis] = await Promise.all([
      fetchJSON<SummaryData>(summaryUrl),
      fetchJSON<{ items: TxItem[] }>(txIncomeUrl),
      fetchJSON<{ items: TxItem[] }>(txDispatchUrl),
    ])
    summary = s
    incomes = inc.items || []
    dispatches = dis.items || []
  } catch (e) {
    // If API fails, continue with empty datasets (will still export CSV)
    console.error('加载导出数据失败：', e)
  }

  // Try to export .xlsx first
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    // Summary sheet
    const summaryRows: any[][] = [
      ['账单统计'],
      ['日期', day],
      ['群组', chatId || '全部'],
    ]
    if (summary) {
      summaryRows.push(
        ['总入款金额 (RMB)', summary.totalIncome ?? 0],
        ['总入款 (USDT)', summary.totalIncomeUSDT ?? 0],
        ['总下发金额 (RMB)', summary.totalDispatch ?? 0],
        ['总下发 (USDT)', summary.totalDispatchUSDT ?? 0],
        ['平均汇率', summary.averageRate ?? 0],
        ['平均费率(%)', summary.averageFee ?? 0],
        ['未下发 (RMB)', summary.notDispatched ?? 0],
        ['未下发 (USDT)', summary.notDispatchedUSDT ?? 0],
      )
    }
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
    wsSummary['!cols'] = [{ wch: 18 }, { wch: 20 }]
    // Force 群组 单元格为文本（B3）
    if (chatId) {
      const addr = 'B3'
      if (!wsSummary[addr]) wsSummary[addr] = { t: 's', v: chatId }
      else wsSummary[addr] = { t: 's', v: chatId }
    }
    XLSX.utils.book_append_sheet(wb, wsSummary, '摘要')

    // Incomes sheet
    const incomeRows: any[][] = [
      ['时间', '金额(RMB)', 'USDT', '汇率', '回复人', '操作人'],
      ...incomes.map((r) => [
        new Date(r.createdAt).toLocaleString('zh-CN'),
        r.amount,
        r.usdt ?? '',
        r.rate ?? '',
        r.replier || '',
        r.operator || '',
      ]),
    ]
    const wsIncome = XLSX.utils.aoa_to_sheet(incomeRows)
    wsIncome['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }]
    wsIncome['!autofilter'] = { ref: `A1:F${incomeRows.length}` }
    XLSX.utils.book_append_sheet(wb, wsIncome, '入款')

    // Dispatches sheet
    const dispatchRows: any[][] = [
      ['时间', '金额(RMB)', 'USDT', '汇率', '回复人', '操作人'],
      ...dispatches.map((r) => [
        new Date(r.createdAt).toLocaleString('zh-CN'),
        r.amount,
        r.usdt ?? '',
        r.rate ?? '',
        r.replier || '',
        r.operator || '',
      ]),
    ]
    const wsDispatch = XLSX.utils.aoa_to_sheet(dispatchRows)
    wsDispatch['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }]
    wsDispatch['!autofilter'] = { ref: `A1:F${dispatchRows.length}` }
    XLSX.utils.book_append_sheet(wb, wsDispatch, '下发')

    // Category stats (by operator / replier)
    const byOperator = new Map<string, number>()
    incomes.forEach((r) => {
      const k = r.operator || '未填'
      byOperator.set(k, (byOperator.get(k) || 0) + (r.amount || 0))
    })
    const byReplier = new Map<string, number>()
    incomes.forEach((r) => {
      const k = r.replier || '未填'
      byReplier.set(k, (byReplier.get(k) || 0) + (r.amount || 0))
    })

    const catRows: any[][] = [
      ['入款操作人分类', '金额(RMB)'],
      ...[...byOperator.entries()].map(([k, v]) => [k, v]),
      [],
      ['入款回复人分类', '金额(RMB)'],
      ...[...byReplier.entries()].map(([k, v]) => [k, v]),
    ]
    const wsCat = XLSX.utils.aoa_to_sheet(catRows)
    wsCat['!cols'] = [{ wch: 20 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, wsCat, '分类')

    const fileName = `账单_${day}${chatId ? `_${chatId}` : ''}.xlsx`
    XLSX.writeFile(wb, fileName)
    return
  } catch (e) {
    // Fallback to CSV when xlsx is not available
    console.warn('xlsx 不可用，回退到 CSV 导出', e)
  }

  // Fallback CSV (single file)
  let csvContent = "\uFEFF"
  csvContent += `账单统计\n`
  csvContent += `日期,${day}\n`
  if (chatId) {
    // Keep as text in Excel by using formula-style text wrapper
    csvContent += `群组,="${chatId}"\n`
  } else {
    csvContent += `群组,全部\n`
  }
  if (summary) {
    csvContent += `总入款金额 (RMB),${summary.totalIncome ?? 0}\n`
    csvContent += `总入款 (USDT),${summary.totalIncomeUSDT ?? 0}\n`
    csvContent += `总下发金额 (RMB),${summary.totalDispatch ?? 0}\n`
    csvContent += `总下发 (USDT),${summary.totalDispatchUSDT ?? 0}\n`
    csvContent += `平均汇率,${summary.averageRate ?? 0}\n`
    csvContent += `平均费率(%) ,${summary.averageFee ?? 0}\n`
    csvContent += `未下发 (RMB),${summary.notDispatched ?? 0}\n`
    csvContent += `未下发 (USDT),${summary.notDispatchedUSDT ?? 0}\n`
  }
  csvContent += "\n入款记录\n"
  csvContent += "时间,金额(RMB),USDT,汇率,回复人,操作人\n"
  incomes.forEach((r) => {
    csvContent += `${new Date(r.createdAt).toLocaleString('zh-CN')},${r.amount},${r.usdt ?? ''},${r.rate ?? ''},${r.replier || ''},${r.operator || ''}\n`
  })
  csvContent += "\n下发记录\n"
  csvContent += "时间,金额(RMB),USDT,汇率,回复人,操作人\n"
  dispatches.forEach((r) => {
    csvContent += `${new Date(r.createdAt).toLocaleString('zh-CN')},${r.amount},${r.usdt ?? ''},${r.rate ?? ''},${r.replier || ''},${r.operator || ''}\n`
  })

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `账单_${day}${chatId ? `_${chatId}` : ''}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
