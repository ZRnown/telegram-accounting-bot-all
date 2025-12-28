-- 直接导入旧数据库数据的SQL脚本
-- 在空的 app.db 数据库上执行
-- 前提：你已经运行过 npx prisma db push 来创建表结构

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- 导入 Bot 表数据
INSERT OR IGNORE INTO Bot (id, name, description, token, proxyUrl, enabled, createdAt, updatedAt)
VALUES
('cmhevfs6200011shi7mfkem1a','@yurongjz_bot',NULL,'8366931157:AAEUTvCeb1RQWm_zcPvoAzoXLjVsaN6e9eY',NULL,1,1761916240730,1761916240730),
('cmi2o5nuc00001snx1a1v2kff','@yrmfjzbot',NULL,'8436745859:AAHK3nTos074rQ3j5Qzyq2bw_OWMc3ZYsBM',NULL,1,1763355199476,1766024996829);

-- 导入 WhitelistedUser 表数据
INSERT OR IGNORE INTO WhitelistedUser (id, userId, username, note, createdAt, updatedAt)
VALUES
('cmiibw8rr000d4hvwhb9pxzbo','7976867022','@dcbj6688','老大',1764302063463,1764302063463),
('cmiibx2pb000e4hvwk2f4369i','5053390963','@GJ555666','财务俊',1764302102255,1764302102255),
('cmiibxh2v000f4hvwsaxercn1','7862093562','@tailande8899','自己',1764302120887,1764302120887);

-- 导入 Chat 表数据
INSERT OR IGNORE INTO Chat (id, title, createdAt, status, allowed, botId)
VALUES
('8357130132','',1762657772259,'PENDING',0,'cmhevfs6200011shi7mfkem1a'),
('7862093562','@tailande8899',1762661477859,'APPROVED',1,'cmhevfs6200011shi7mfkem1a'),
('7976547423','@rsqic666',1763271913375,'PENDING',0,'cmhevfs6200011shi7mfkem1a'),
('7976867022','@dcbj6688',1763356250590,'APPROVED',1,'cmi2o5nuc00001snx1a1v2kff'),
('7141784616','@Thy1cc',1763880216177,'PENDING',0,'cmi2o5nuc00001snx1a1v2kff'),
('5105102824','稳定平台昭代理，保证不黑不卡',1765306760041,'PENDING',0,'cmi2o5nuc00001snx1a1v2kff'),
('7189041207','',1765874281864,'PENDING',0,'cmhevfs6200011shi7mfkem1a'),
('5455854362','sam Hai',1765987638746,'PENDING',0,'cmhevfs6200011shi7mfkem1a'),
('8221140785','@yurong08',1766286842683,'PENDING',0,'cmhevfs6200011shi7mfkem1a'),
('7721494680','@huifalbu99',1766394859961,'PENDING',0,'cmi2o5nuc00001snx1a1v2kff'),
('-5078116365','公群g2863泰国对接',1766716996136,'PENDING',0,'cmhevfs6200011shi7mfkem1a'),
('-5030978535','上班努力工作ตั้งใจทำงานหนัก',1766717004200,'PENDING',0,'cmi2o5nuc00001snx1a1v2kff'),
('-5181543741','功能演示',1766727572894,'APPROVED',1,'cmhevfs6200011shi7mfkem1a');

-- 导入 Setting 表数据
INSERT OR IGNORE INTO Setting (
    id, chatId, feePercent, fixedRate, realtimeRate, displayMode,
    headerText, everyoneAllowed, accountingMode, featureWarningMode,
    addressVerificationEnabled, dailyCutoffHour, hideHelpButton,
    hideOrderButton, overDepositLimit, lastOverDepositWarning, deleteBillConfirm,
    accountingEnabled, calculatorEnabled, showAuthPrompt, welcomeMessage
)
VALUES
('cmhr74stv00f51sba2la7hj3d','7862093562',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmi1akjvl0alw1swnk8qxkewe','7976547423',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmi2os6wd000n1sgj3xplgvhg','7976867022',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmibcqlbv00014h7yldigiklx','7141784616',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmiyy2dos002d4h8ypvkiuf1s','5105102824',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmj8byca50o0i4h8xphrw5q26','7189041207',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmja7fz060sac4h8xscf81b9f','5455854362',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmjf5ky8v00014hry7v8lgdfw','8221140785',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmjgxw4w701l64hrzegrtisw3','7721494680',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmjm9omri0cig4hry1ghldoj2','-5078116365',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmjm9osz706834hrzptpofs1z','-5030978535',0.0,NULL,6.9100000000000001421,1,NULL,0,'DAILY_RESET','always',0,0,0,0,0.0,NULL,0,1,1,1,NULL),
('cmjmfzbu10cim4hry32frhrmw','-5181543741',0.0,40.0,NULL,1,NULL,0,'DAILY_RESET','always',1,0,0,0,0.0,NULL,0,1,1,1,NULL);

-- 导入 Bill 表数据
INSERT OR IGNORE INTO Bill (id, chatId, status, openedAt, savedAt, closedAt)
VALUES
('cmjmg06ql0cjw4hrytxmmcajr','-5181543741','OPEN',1766678400000,1766727612956,NULL);

-- 导入 AddressVerification 表数据
INSERT OR IGNORE INTO AddressVerification (
    id, chatId, confirmedAddress, confirmedCount, pendingAddress,
    pendingCount, lastSenderId, lastSenderName, createdAt, updatedAt
)
VALUES
('cmhog2b6s010c1s1c34hgxr1n','-5088116466','TQMZQRFqxu8sK7ZHmoMjgqnLVhf6jSY3fV',6,NULL,0,'8435562485','@zu1678',1762495079717,1763805338789),
('cmhuf7jq802y31sx1pl759vb5','-4736767656','TQg8VYJbea9ZHPeLECfWjyrhwbbszSesP9',3,NULL,0,'7416589879','@FG91_3',1762856441504,1763643553740),
('cmi0a8a1w09pe1swnw15kcwg6','-5096501278','TCRNJFKnHGjwmbe4oGGb69i8oyJ8SLWrhU',3,NULL,0,'8400245745','@HYZF_S2',1763210874596,1763469823236),
('cmi4fwr3g0dx81splsgz0x856','-5091321452','TBxVKGuW4u112Q66Hgk6mnSjVeLnk8KerU',1,NULL,0,'7030112987','McSpicy Chicken Burger',1763462279212,1763462279212),
('cmjmg289d0ckt4hrycio5lw7w','-5181543741','TH7oFK4DKasqf56WNLN4Xy4NbTXEezUBNQ',1,'TH7oFK4DKasqf56WNLN4Xy4NbTXEezUBNj',1,'7862093562','@tailande8899',1766727708242,1766727714162);

-- 导入 GlobalConfig 表数据（包含自定义命令）
INSERT OR IGNORE INTO GlobalConfig (id, key, value, description, updatedAt, updatedBy)
VALUES
('cmigxuiit00024hvwxqkj4s50','customcmds:bot:cmhevfs6200011shi7mfkem1a','{"豫融地址":{"text":"TEu5eX8RuEx2ZW3SJ87BRzdyYy91RnHZjv\n\n此地址为豫融专属唯一地址，请放心交易，望知悉惠存。地址如有变动请语音确认核实！！！","updatedAt":"2025-12-10T03:10:52.413Z","updatedBy":"admin","imageUrl":"https://lanbang123.oss-cn-beijing.aliyuncs.com/%E5%9C%B0%E5%9D%80.jpg"},"取消":{"text":"已为您取消申请额度，额度将会进行释放，请勿私自入金。\n—————————————————————————\n注⚠️：如需要入金请重新获取账户,私自入款不承担任何责任,谢谢配合！","updatedAt":"2025-12-12T06:13:13.287Z","updatedBy":"admin"},"拉停":{"text":"账户冻结  ❌❌❌停止一切入款❌❌❌\n账户冻结  ❌❌❌停止一切入款❌❌❌\n账户冻结  ❌❌❌停止一切入款❌❌❌","updatedAt":"2025-12-16T07:16:24.819Z","updatedBy":"admin"},"已报备":{"text":"请放心操作，公群已经为你报备，入款后第一时间发送水单核查。\n如果取消请告知我们，期待你的下次报金！\n\n报备：泰铢\n卡主姓名：*****\n银行名称：******\n银行卡号后四位：****\n入金模式：进算\n入金金额： xxxxxTHB\n料性：无视 维护一小时\n完整回U地址：*********** \n附加规则：公群规则附加小群补充规则","updatedAt":"2025-12-15T10:26:51.438Z","updatedBy":"admin"},"无视拖算规则":{"text":"泰国通道规则：\n一、每次入款前需告知通道，通知客服大概金额，得到通道方许可方能入款\n\n二、因风控问题导致的银行卡普通冻结，或司法冻结，通道方要提供视频，或图片。\n\n三、账户出现异常，通道方会第一时间报暂停入金，报停后的入金，一概不做数。\n\n四、如遇到银行临时维护的状态，维护好第一时间报。 时间延长至维护好拖出为准。\n\n五、拖算，拖出卸货成功进行加分，不保时，\n\n六、账户异常，冻结或者限额的一律不安排户主解卡。\n\n七、请看清楚规则，不按规则操作出了问题一概不负责。\n\n八、政府公务员和警察军人入款必须提前通知（以水单军衔警衔为准）未通知入款扣除单笔入款并罚款2000U卡费 。\n\n其中冻结视频分为两种\n1，其一是不能登录的状况（无法看到流水）由于客诉原因，无法让户主去ATM刷流水。\n2，其二是无法转出的情况（可以看到流水，帐号里面余额，或显示负数等）\n\n           请遵守通道规则，相互配合","updatedAt":"2025-12-18T02:48:34.192Z","updatedBy":"admin"},"钱包规则":{"text":"泰国 钱包二维码【500-10000进算规则：\n\n1、入款料性：所有资金有效到账就加分，刷单，精聊，大区，进算保当天客诉。\n\n2、置顶码 \n入款金额：单笔500株-10000株，单笔入金低于500株的均视为无效入款，不加账。\n\n3、码子是置顶码入，拉停后缓冲失效5分钟账户不死缓冲时效内的入账全部正常加分。账号死拉停后是同一分钟内入款的正常加分，缓冲内的入款将不予入账，（例如12:00报拉停12:01内的时间入款正常加分缓冲12:06，以入款水单转账时间为准。）（拉停时间：由于网络有延迟我们以截图水房拉停时间为准不扯皮）。\n\n4、防止惨料行为，卡死车队会抽查盘口切客记录，盘口必须无条件配合，如果1小时内内盘口没有配合给出切客记录一律按照惨料来处理。\n\n5、若入金当天泰国时间晚上12点之前客诉，需扣除单笔客诉金额，由于泰国没有天眼，客诉只认app冻结金额。（流水只有单笔金额客诉，无争议直接扣除单笔。如果有重复金额则需要相关会员的聊天记录和客诉时间以后的充值记录，如果不能提供客诉以后的充值记录，既认定是该会员的问题。不扯皮）。\n\n\n⚠️ 请仔细阅读新规则  最终解释权归本群通道方所有，入金即默认，禁止一切扯皮，谢谢配合！⚠️\n\n👌通道珍贵，保护通道，合作共赢","updatedAt":"2025-12-18T02:49:05.263Z","updatedBy":"admin"},"泰国精料":{"text":"泰国精算进算规则：\n\n1、入款料性：所有资金有效到账就加分，刷单，精聊，大区，\n\n\n3、入款时效：10分钟内入金。超过10分钟需要申请重新测卡，若未申请延时造成的损失由盘口自行承担。所有卡时只有10分钟，如未申请延时测卡，超时入金按脱出为准。如未脱出所造成的损失由盘口自行承担，如遇到延时到账，最终以脱出为准。\n\n4、报停卡的同一分钟内，入款盘口与通道方各承担一半，报停后再入款将不予入账，（例如12:00报死卡12:00内的时间入款，盘口与通道方各承担一半，以入款水单转账时间为准。）（拉停时间：由于网络有延迟我们以截图水房拉停时间为准不扯皮）。\n\n5、防止惨料行为，卡死车队会抽查盘口切客记录，盘口必须无条件配合，如果30分钟内盘口没有配合给出切客记录一律按照惨料来处理。\n\n6，没有按照报备金额入款、乱入等，一律不回款。\n\n7、若入金当天泰国时间晚上12点之前客诉，需扣除单笔客诉金额，由于泰国没有天眼，客诉只认app冻结金额。（流水只有单笔金额客诉，无争议直接扣除单笔。如果有重复金额则需要相关会员的聊天记录和客诉时间以后的充值记录，如果不能提供客诉以后的充值记录，既认定是该会员的问题。不扯皮）。\n\n\n若发现参杂料进来，本公司只收不付，并需要盘口方/入款方赔偿一切损失, 包括其中卡费 ,  冻结和风控的所有账户里的资金。不扯皮。\n\n请在入款前注明好入款料子，以免造成误会\n\n⚠️ 请仔细阅读新规则  最终解释权归本群通道方所有，入金即默认，禁止一切扯皮","updatedAt":"2025-12-18T02:51:38.598Z","updatedBy":"admin"},"老挝规则":{"text":"老挝本地卡直通车\n入款区间：5万LAK-2亿LAK（500万以上喊卡）\n出款区间：5万LAK起\n上课时间：根据盘口需求\n到账时间：实际到账为准\n结算方式：拖出后加分\n回U金额：随时下发\n注意事项：\n1.入款带金额，水单，付款人姓名，我方实时配合进行核实，查账人员在群里回复加分视为有效金额！\n2.转账时需要选择紧急付款或者立即到账，转账未选择即时到账或紧急转账，会出现延迟到账或周末不到账！以实际到账为准，封卡后无法查账和加分！\n3.入款出现冻结，车队尽力处理解冻，解开后添加，到账20分钟内被限制转出，车队不负责，到账20分钟后未卸出由车队承担。\n4.风控冻结会出现这几种状况，可沟通提供视频证明1：可登录显额，无法转账或者金额显示负数2：无法登录（这种情况下无法提供视频和流水）\n5.大额叫卡需要20内及时入款，超过20分钟内没入款需要重新测卡，如果超时未重新喊卡或者取消后入款，出现封卡或者被偷，一概不负责\n6.置顶卡单笔禁止超过500万，分笔禁止连续入款，一笔拖出之后再进下一笔，车队回复继续进之后才能进.私自入款，造成死卡或者资金被盗等情况，盘口负责\n6.出现冻结死卡车队会喊卡封，卡封之后如果后续能处理，会正常加分，无法处理的无法加分\n7.出现卡主盗款导致资金损失，车队全责，正常加分\n开始合作默认以上规则！","updatedAt":"2025-12-18T02:50:38.598Z","updatedBy":"admin"}}','Custom commands for bot cmhevfs6200011shi7mfkem1a',1766563984482,'admin'),
('cmizehfjr00684h8y311z8d7l','customcmd:-4855654465:小十地址','{"content":"这里是内容","parseMode":"Markdown","imageUrl":"https://pic.rmb.bdstatic.com/bjh/ce14020c09cd67d9f0121bc0eb5bff372120.jpeg@h_1280"}','Custom command 小十地址 for -4855654465',1765334867037,'system'),
('cmizehfk200694h8y0a1o4wlk','customcmd_index:-4855654465','["小十地址","豫融地址"]','Custom commands index for -4855654465',1765335456129,'system'),
('cmizf5fl800974h8yynz62nkp','customcmd:-4855654465:豫融地址','{"content":"TEu5eX8RuEx2ZW3SJ87BRzdyYy91RnHZjv\n\n此地址为豫融专属唯一地址，请放心交易，望知悉惠存。地址如有变动请语音确认核实！！！","parseMode":"Markdown","imageUrl":"https://lanbang123.oss-cn-beijing.aliyuncs.com/%E5%9C%B0%E5%9D%80.jpg"}','Custom command 豫融地址 for -4855654465',1765335466711,'system'),
('cmizfdlpv001i4hecszve72l8','customcmds:bot:cmi2o5nuc00001snx1a1v2kff','{"豫融地址":{"text":"TEu5eX8RuEx2ZW3SJ87BRzdyYy91RnHZjv\n\n此地址为豫融专属唯一地址，请放心交易，望知悉惠存。地址如有变动请语音确认核实！！！","updatedAt":"2025-12-10T03:03:58.266Z","updatedBy":"admin"},"取消":{"text":"已为您取消申请额度，额度将会进行释放，请勿私自入金。\n—————————————————————————\n注⚠️：如需要入金请重新获取账户,私自入款不承担任何责任,谢谢配合！","updatedAt":"2025-12-12T06:14:52.629Z","updatedBy":"admin"},"拉停":{"text":"账户冻结  ❌❌❌停止一切入款❌❌❌\n账户冻结  ❌❌❌停止一切入款❌❌❌\n账户冻结  ❌❌❌停止一切入款❌❌❌","updatedAt":"2025-12-16T07:16:51.131Z","updatedBy":"admin"}}','Custom commands for bot cmi2o5nuc00001snx1a1v2kff',1765869411131,'admin');

COMMIT;
PRAGMA foreign_keys=ON;

-- 验证导入结果
SELECT '导入完成！检查数据量：';
SELECT 'Bot: ' || COUNT(*) FROM Bot
UNION ALL
SELECT 'Chat: ' || COUNT(*) FROM Chat
UNION ALL
SELECT 'Setting: ' || COUNT(*) FROM Setting
UNION ALL
SELECT 'WhitelistedUser: ' || COUNT(*) FROM WhitelistedUser
UNION ALL
SELECT 'AddressVerification: ' || COUNT(*) FROM AddressVerification
UNION ALL
SELECT 'GlobalConfig: ' || COUNT(*) FROM GlobalConfig;
