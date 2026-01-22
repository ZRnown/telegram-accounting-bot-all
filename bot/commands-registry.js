export const commandsRegistry = [
  // 基础记账
  { type: 'exact', key: '开始记账', title: '开始记账', desc: '激活机器人并开始记录', examples: ['开始', '开始记账'], group: '基础记账' },
  { type: 'exact', key: '停止记账', title: '停止记账', desc: '暂停机器人记录', examples: ['停止', '停止记账'], group: '基础记账' },
  { type: 'prefix', key: '下发', title: '下发', desc: '记录下发金额，支持 RMB/USDT', examples: ['下发10', '下发10u'], group: '基础记账' },
  { type: 'prefix', key: '备注 下发', title: '备注下发', desc: '备注重下发', examples: ['备注 下发1000'], group: '基础记账' },

  // 账单相关
  { type: 'exact', key: '显示账单', title: '显示账单', desc: '查看当前账单', examples: ['显示账单', '+0'], group: '账单' },
  { type: 'exact', key: '显示历史账单', title: '显示历史账单', desc: '查看已保存账单', examples: ['显示历史账单'], group: '账单' },
  { type: 'exact', key: '查看账单', title: '查看账单', desc: '查看完整账单（后台链接）', examples: ['查看账单'], group: '账单' },
  { type: 'exact', key: '保存账单', title: '保存账单', desc: '保存并清空当前', examples: ['保存账单'], group: '账单' },
  { type: 'exact', key: '删除账单', title: '删除账单', desc: '清空当前（不保存）', examples: ['删除账单'], group: '账单' },
  { type: 'exact', key: '删除全部账单', title: '删除全部账单', desc: '清除全部账单', examples: ['删除全部账单'], group: '账单' },
  { type: 'exact', key: '我的账单', title: '我的账单', desc: '查看自己的记账记录', examples: ['我的账单', '/我'], group: '账单' },
  { type: 'exact', key: '指定账单', title: '指定账单', desc: '回复指定人消息后查看其记录', examples: ['账单'], group: '账单' },

  // 帮助
  { type: 'exact', key: '使用说明', title: '使用说明', desc: '显示帮助文档', examples: ['使用说明'], group: '帮助' },

  // 汇率/费率
  { type: 'prefix', key: '设置汇率', title: '设置汇率', desc: '固定汇率（1U=...）', examples: ['设置汇率 7.2', '设置汇率7.2'], group: '汇率费率' },
  { type: 'exact', key: '设置实时汇率', title: '设置实时汇率', desc: '自动抓取市场汇率', examples: ['设置实时汇率'], group: '汇率费率' },
  { type: 'exact', key: '刷新实时汇率', title: '刷新实时汇率', desc: '手动更新实时汇率', examples: ['刷新实时汇率'], group: '汇率费率' },
  { type: 'exact', key: '显示实时汇率', title: '显示实时汇率', desc: '查看汇率', examples: ['显示实时汇率'], group: '汇率费率' },
  { type: 'prefix', key: '设置货币', title: '设置货币', desc: '切换本群记账币种', examples: ['设置货币 USD', '设置货币 CNY'], group: '汇率费率' },
  { type: 'exact', key: '显示货币', title: '显示货币', desc: '查看当前群的币种', examples: ['显示货币'], group: '汇率费率' },
  { type: 'prefix', key: '设置费率', title: '设置费率', desc: '设置手续费百分比', examples: ['设置费率 5'], group: '汇率费率' },

  // 额度提醒
  { type: 'prefix', key: '设置额度', title: '设置额度', desc: '设置超押提醒额度', examples: ['设置额度 10000', '设置额度10000'], group: '额度提醒' },

  // 记账模式
  { type: 'prefix', key: '设置记账模式', title: '设置记账模式', desc: '选择记账模式', examples: ['设置记账模式 清零模式'], group: '记账模式' },
  { type: 'prefix', key: '查看记账模式', title: '查看记账模式', desc: '查看当前模式', examples: ['查看记账模式'], group: '记账模式' },
  { type: 'prefix', key: '设置日切时间', title: '设置日切时间', desc: '设置每日结算起始时间', examples: ['设置日切时间 2'], group: '记账模式' },

  // 显示模式
  { type: 'prefix', key: '显示模式', title: '显示模式', desc: '配置显示记录条数', examples: ['显示模式4'], group: '显示模式' },
  { type: 'exact', key: '人民币模式', title: '单币显示', desc: '仅显示当前币种', examples: ['人民币模式'], group: '显示模式' },
  { type: 'exact', key: '双显模式', title: '双币显示', desc: '当前币种与USDT双显', examples: ['双显模式'], group: '显示模式' },

  // 权限
  { type: 'prefix', key: '添加操作员', title: '添加操作员', desc: '添加多个操作员', examples: ['添加操作员 @AAA @BBB'], group: '权限' },
  { type: 'prefix', key: '删除操作员', title: '删除操作员', desc: '删除多个操作员', examples: ['删除操作员 @AAA @BBB'], group: '权限' },
  { type: 'exact', key: '显示操作人', title: '显示操作人', desc: '显示群组权限信息', examples: ['显示操作人', '管理员', '权限人'], group: '权限' },

  // OKX 查询
  { type: 'exact', key: 'z0', title: 'z0', desc: 'OKX 实时U价', examples: ['z0'], group: 'OKX' },
  { type: 'exact', key: 'lz', title: 'lz', desc: 'OKX 支付宝U价', examples: ['lz'], group: 'OKX' },
  { type: 'exact', key: 'lw', title: 'lw', desc: 'OKX 微信U价', examples: ['lw'], group: 'OKX' },
  { type: 'exact', key: 'lk', title: 'lk', desc: 'OKX 银行卡U价', examples: ['lk'], group: 'OKX' },

  // 查询
  { type: 'prefix', key: '查', title: '查', desc: '查询TRON地址/手机号/银行卡信息', examples: ['查 T开头地址', '查 18888888888', '查 20000000000000000'], group: '查询' },

  // 其他
  { type: 'prefix', key: '设置标题', title: '设置标题', desc: '自定义账单标题', examples: ['设置标题 本群账单'], group: '其他' },
  { type: 'exact', key: '撤销入款', title: '撤销入款', desc: '撤销最近一条入款记录', examples: ['撤销入款'], group: '其他' },
  { type: 'exact', key: '撤销下发', title: '撤销下发', desc: '撤销最近一条下发记录', examples: ['撤销下发'], group: '其他' },
  { type: 'exact', key: '删除', title: '删除', desc: '回复指定记录消息后删除该记录', examples: ['删除'], group: '其他' },
  { type: 'exact', key: '机器人退群', title: '机器人退群', desc: '机器人退出本群并清除数据', examples: ['机器人退群'], group: '其他' },
  { type: 'exact', key: '开启所有功能', title: '开启所有功能', desc: '启用所有功能开关', examples: ['开启所有功能'], group: '其他' },
  { type: 'exact', key: '关闭所有功能', title: '关闭所有功能', desc: '关闭所有功能开关', examples: ['关闭所有功能'], group: '其他' },
  { type: 'exact', key: '打开计算器', title: '打开计算器', desc: '启用数学计算功能', examples: ['打开计算器'], group: '其他' },
  { type: 'exact', key: '关闭计算器', title: '关闭计算器', desc: '禁用数学计算功能', examples: ['关闭计算器'], group: '其他' },
  { type: 'exact', key: '群列表', title: '群列表', desc: '列出当前机器人所在的群', examples: ['群列表'], group: '其他' },
  { type: 'prefix', key: '添加自定义指令', title: '添加自定义指令', desc: '新增或编辑文本内容', examples: ['添加自定义指令 小十地址 这里是内容'], group: '其他' },
  { type: 'prefix', key: '设置自定义图片', title: '设置自定义图片', desc: '为指令设置图片URL', examples: ['设置自定义图片 小十地址 https://.../img.png'], group: '其他' },
  { type: 'prefix', key: '删除自定义指令', title: '删除自定义指令', desc: '删除指定的自定义指令', examples: ['删除自定义指令 小十地址'], group: '其他' },
  { type: 'exact', key: '自定义指令列表', title: '自定义指令列表', desc: '查看已配置的自定义指令', examples: ['自定义指令列表'], group: '其他' },
]

export default commandsRegistry;
