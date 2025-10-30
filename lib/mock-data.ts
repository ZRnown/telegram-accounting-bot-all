export interface TransactionRecord {
  time: string
  amount: string
  replier: string
  operator: string
}

export interface DailyData {
  billNumber: number
  totalIncome: number
  exchangeRate: number
  feeRate: number
  shouldDispatch: number
  shouldDispatchUSDT: number
  dispatched: number
  dispatchedUSDT: number
  notDispatched: number
  notDispatchedUSDT: number
  incomeRecords: TransactionRecord[]
  dispatchRecords: TransactionRecord[]
  incomeByReplier: Record<string, number>
  incomeByOperator: Record<string, number>
  incomeByRate: Record<string, number>
  dispatchByReplier: Record<string, number>
}

export function getTransactionData(date: Date): DailyData {
  // Mock data - in real app, this would fetch from API
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()

  if (isToday) {
    return {
      billNumber: 1,
      totalIncome: 20000,
      exchangeRate: 8,
      feeRate: 5,
      shouldDispatch: 19000,
      shouldDispatchUSDT: 2516.17,
      dispatched: 0,
      dispatchedUSDT: 0,
      notDispatched: 19000,
      notDispatchedUSDT: 2516.17,
      incomeRecords: [
        {
          time: "2025-10-13 12:32:53",
          amount: "10000 / 7.15 = 1398.6",
          replier: "时来运转",
          operator: "alang5lang",
        },
        {
          time: "2025-10-13 12:33:02",
          amount: "10000 / 8 = 1250",
          replier: "时来运转",
          operator: "alang5lang",
        },
      ],
      dispatchRecords: [],
      incomeByReplier: {
        时来运转: 20000,
      },
      incomeByOperator: {
        alang5lang: 20000,
      },
      incomeByRate: {
        "7.15": 10000,
        "8": 10000,
      },
      dispatchByReplier: {},
    }
  }

  // Return empty data for other dates
  return {
    billNumber: 0,
    totalIncome: 0,
    exchangeRate: 0,
    feeRate: 0,
    shouldDispatch: 0,
    shouldDispatchUSDT: 0,
    dispatched: 0,
    dispatchedUSDT: 0,
    notDispatched: 0,
    notDispatchedUSDT: 0,
    incomeRecords: [],
    dispatchRecords: [],
    incomeByReplier: {},
    incomeByOperator: {},
    incomeByRate: {},
    dispatchByReplier: {},
  }
}

export function get30DaysSummary() {
  // Mock 30-day summary data
  return {
    totalIncome: 580000,
    totalIncomeUSDT: 75324.68,
    totalDispatch: 520000,
    totalDispatchUSDT: 67532.47,
    totalBills: 28,
    averageRate: 7.7,
    averageFee: 5.2,
    notDispatched: 60000,
    notDispatchedUSDT: 7792.21,
  }
}

export function getWeeklySummary(weekStart: Date) {
  // Mock weekly summary data
  const dailyBreakdown = []

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + i)

    const dateStr = date.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
    })

    // Generate mock data for each day
    const income = Math.floor(Math.random() * 50000) + 10000
    const dispatch = Math.floor(income * 0.9)
    const bills = Math.floor(Math.random() * 5) + 1
    const rate = 7 + Math.random() * 2

    dailyBreakdown.push({
      date: dateStr,
      income,
      dispatch,
      bills,
      rate,
    })
  }

  const totalIncome = dailyBreakdown.reduce((sum, day) => sum + day.income, 0)
  const totalDispatch = dailyBreakdown.reduce((sum, day) => sum + day.dispatch, 0)
  const totalBills = dailyBreakdown.reduce((sum, day) => sum + day.bills, 0)
  const averageRate = dailyBreakdown.reduce((sum, day) => sum + day.rate, 0) / 7

  return {
    totalIncome,
    totalIncomeUSDT: totalIncome / 7.7,
    totalDispatch,
    totalDispatchUSDT: totalDispatch / 7.7,
    totalBills,
    averageRate,
    averageFee: 5.0,
    notDispatched: totalIncome - totalDispatch,
    notDispatchedUSDT: (totalIncome - totalDispatch) / 7.7,
    dailyBreakdown,
  }
}
