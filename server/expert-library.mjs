/**
 * Curated expert playbooks for an enterprise growth Workspace. These are
 * executable work specifications and acceptance criteria, NOT invented customer
 * results, claims of partner availability, or promises that tools are connected.
 */
export const EXPERT_BRIEFS = Object.freeze({
  'growth-lead': {
    headline: '让业务目标变成有预算、有负责人、有验收的工作',
    positioning: '项目指挥与交付负责人',
    scenario: '要在美国验证新产品的分销可行性，组织研究、客户筛选与渠道分析，最终提交可决策的结论。',
    inputs: ['目标产品和企业公开资料', '目标国家、客户类型和阶段性成果', '项目总预算、截止日期、审批负责人'],
    steps: [
      { name: '建立目标和成功标准', detail: '明确市场假设、范围、允许公开的数据，以及每项任务的验收定义。' },
      { name: '形成团队分工方案', detail: '把研究、筛选、资料制作拆成可独立审批的任务，列出依赖与费用上限。' },
      { name: '核查交付与整合建议', detail: '按来源、覆盖率、预算和业务相关性审阅专家成果，列明未解决的问题。' },
    ],
    deliverables: [
      { name: '项目任务分解', format: '结构化计划', acceptance: '每项任务有负责人、目标、依赖、预算与验收标准。' },
      { name: '证据索引与风险清单', format: '审查记录', acceptance: '区分已核验、待核验、推测信息，不混淆实际结果。' },
      { name: '下一阶段决策建议', format: '执行简报', acceptance: '列出可执行的业务建议、关键证据缺口、下一步负责人和需要企业明确批准的决策事项。' },
    ],
    toolNeeds: ['Workspace 项目计划与证据记录', '只读研究结果', '人工审批与预算控制'],
    boundaries: ['团队分工规划不等于已经启动多个 Worker', '预算变更、对外沟通、付费执行需要独立审批'],
  },
  'buyer-hunter': {
    headline: '把模糊的客户群体，变成可逐条核查的经销商名单',
    positioning: '海外分销与 B2B 潜在客户研究',
    scenario: '根据产品品类与目标市场寻找有真实业务依据的进口商、批发商与分销商，保留每条名单的官网来源。',
    inputs: ['产品类别、公开规格与适用场景', '目标国家、行业、渠道及不匹配条件', '候选客户数量与筛选深度'],
    steps: [
      { name: '构建理想买手画像', detail: '确定进口商、代理商、批发商的必要特征和排除条件。' },
      { name: '搜索与抓取公开证据', detail: '从官网、产品目录和可信公开资料寻找公司业务线索；不猜测联系人。' },
      { name: '去重与匹配评分', detail: '按企业网站去重，解释产品和渠道匹配的理由，标出未核验字段。' },
    ],
    deliverables: [
      { name: '候选公司列表', format: '表格 / JSON', acceptance: '逐行包含公司名、国家、官网、来源 URL 与匹配理由。' },
      { name: '目标画像与筛选依据', format: '研究记录', acceptance: '解释选择或排除买手类型的业务依据，并列明匹配条件、排除条件与尚未确认的信息。' },
      { name: '推荐下一步', format: '行动清单', acceptance: '区分需要背调、人工联系和进一步询价的对象。' },
    ],
    toolNeeds: ['联网搜索 / 公开网页抓取', '网页证据保存', '企业公开产品资料'],
    boundaries: ['不会自动发送邮件或添加私人联系方式', '未独立验证的联系人、采购意向与金额不能当作事实'],
  },
  'market-analyst': {
    headline: '用可核验的竞争信息判断市场机会',
    positioning: '产品竞争研究与机会判断',
    scenario: '评估一个产品是否适合进入新的国家市场，对比竞争品、渠道价格和用户需求信号。',
    inputs: ['产品公开规格、差异化卖点', '市场、竞品范围、渠道', '要验证的价格或销售假设'],
    steps: [
      { name: '定义研究问题', detail: '把宽泛市场判断拆成产品、渠道、价格和客户需求四类问题。' },
      { name: '收集证据与日期', detail: '为每个竞争参考记录来源、采集日期、可比规格与口径限制。' },
      { name: '给出可验证结论', detail: '区分公开可证实的数据与推断，提出低成本验证方法。' },
    ],
    deliverables: [
      { name: '竞品对照表', format: '表格', acceptance: '价格与规格口径一致，逐项标注出处和时间。' },
      { name: '市场机会简报', format: '一页结论', acceptance: '将事实、推断与信号质量分栏呈现，明确采集日期、来源可比性和仍待回答的问题。' },
      { name: '验证实验建议', format: '计划', acceptance: '写明可观测的验证指标、单项预算上限、试验时段和不达标时的停止条件。' },
    ],
    toolNeeds: ['公开数据搜索', '研究证据抓取', '可追溯价格与产品来源'],
    boundaries: ['不把浏览量、讨论热度写成销量', '真实销量和采购额必须有可核查的数据源'],
  },
  'channel-planner': {
    headline: '判断先做哪个市场、哪个渠道、为什么',
    positioning: '渠道增长方案与低成本试验',
    scenario: '比较进口商代理、批发分销和跨境电商等不同路径，选择最符合产品和资源条件的进入方式。',
    inputs: ['产品供货条件、MOQ 与可公开政策', '目标客户与区域', '测试资源、预算和时间窗口'],
    steps: [
      { name: '梳理进入路径', detail: '明确分销、代理、B2C 测试各自的供货、获客和履约要求。' },
      { name: '渠道可行性评分', detail: '比较客户获取难度、商业门槛、渠道竞争和执行成本。' },
      { name: '设计小规模试验', detail: '提出分步验证动作与明确退出条件，而非先做大规模投放。' },
    ],
    deliverables: [
      { name: '渠道选择矩阵', format: '评分表', acceptance: '每个渠道评分包含权重、比较维度、原始来源、不可比较之处和不确定性说明。' },
      { name: '渠道进入方案', format: '结构化计划', acceptance: '列明目标客群、资源需求、关键约束和责任人。' },
      { name: '阶段性测试方案', format: '行动计划', acceptance: '为每一阶段写明可量化指标、所需资源、预算上限、审批点与明确的退出条件。' },
    ],
    toolNeeds: ['竞争与渠道公开研究', '企业供货资料', '预算与实验记录'],
    boundaries: ['不擅自发布广告、绑定店铺或签订代理政策', '市场验证结论不能替代真实订单数据'],
  },
  'sales-specialist': {
    headline: '把产品资料变成买手愿意读的销售表达',
    positioning: '国际 B2B 销售内容与商机推进',
    scenario: '针对明确的买手类型准备英文产品介绍、常见异议解答和人工审核的跟进草稿。',
    inputs: ['产品事实、认证与可公开案例', '买手角色、痛点、采购流程', '沟通目标及地区政策'],
    steps: [
      { name: '提炼买手价值主张', detail: '从规格和供货能力转译成目标买手关注的风险、利润与合作效率。' },
      { name: '构建沟通素材', detail: '整理英文介绍、FAQ、回应异议和报价前信息采集。' },
      { name: '审查事实与权限', detail: '逐项确认产品事实与地区政策，外部发送必须另行批准。' },
    ],
    deliverables: [
      { name: '英文销售介绍', format: '可编辑文案', acceptance: '与公开产品资料一致，不虚构认证、客户或供货承诺。' },
      { name: '买手 FAQ 与异议库', format: '问答清单', acceptance: '覆盖 MOQ、样品、交期和合作方式，未知项明确标记。' },
      { name: '跟进消息草稿', format: '人工审核草稿', acceptance: '消息要针对目标买手的公开业务背景编写，并标注人工审核人、未知事实与禁止自动发送的边界。' },
    ],
    toolNeeds: ['公开产品与 FAQ', '销售素材版本库', '可审批的消息渠道（后续）'],
    boundaries: ['不直接发送开发信或操作客户邮箱', '价格、库存、承诺以企业授权资料为准'],
  },
  'brand-designer': {
    headline: '交付可直接审核的海外品牌与销售内容',
    positioning: '品牌素材组织与独立站文案',
    scenario: '为海外买手搭建一套统一的产品故事、落地页信息架构和销售资料包。',
    inputs: ['产品卖点与实际图片、认证或案例', '目标客户与品牌定位', '语言、站点形式和交付规格'],
    steps: [
      { name: '梳理品牌信息', detail: '提炼公司可信证明、产品价值与适合海外采购场景的核心信息。' },
      { name: '规划交付资产', detail: '制作 Landing Page 文案结构、销售单页与素材需求说明。' },
      { name: '校对与交付', detail: '核对技术参数和授权素材，交付可编辑内容及缺失资产列表。' },
    ],
    deliverables: [
      { name: 'Landing Page 内容结构', format: '可编辑页面稿', acceptance: '具有清晰价值主张、证据位置、FAQ 和询盘转化入口。' },
      { name: 'Sales Pack 大纲与英文文案', format: '销售资料', acceptance: '信息层级一致，所有性能或认证主张可溯源。' },
      { name: '视觉素材需求表', format: '设计清单', acceptance: '清楚标示已有素材、需要制作的文件与审核要求。' },
    ],
    toolNeeds: ['公司和产品资料库', '授权设计素材', '设计或站点执行器（需额外绑定）'],
    boundaries: ['当前默认产物是策划与可编辑文案，不冒充已完成图片渲染', '站点发布、设计工具执行需要独立审核的工具连接'],
  },
  'commerce-tester': {
    headline: '在真正投入前做出可退出的销售验证计划',
    positioning: '跨境电商机会与小预算验证',
    scenario: '为拟进入美国等海外市场的产品评估平台竞争、差异化机会与最小化销售试验。',
    inputs: ['拟测产品与可公开的成本条件', '目标平台及目标市场', '最高试验预算和成功门槛'],
    steps: [
      { name: '拆解产品销售假设', detail: '明确客户为什么购买、竞争替代方案及履约的关键限制。' },
      { name: '核验竞品与渠道', detail: '只使用有公开来源、采集时间和清楚口径的数据。' },
      { name: '设计 MVP 销售测试', detail: '提出渠道、素材、受众、指标和明确停止条件。' },
    ],
    deliverables: [
      { name: '机会假设清单', format: '结构化研究', acceptance: '为每条关键销售假设标记可验证指标、拟采用的获取方式、证据缺口和可能推翻假设的条件。' },
      { name: '竞品与渠道参考', format: '表格', acceptance: '完整保留商品和渠道原始链接、采集日期、规格可比性、数据来源与可信度限制。' },
      { name: '小预算验证计划', format: '执行计划', acceptance: '同时说明项目总预算、每项试验费用上限、关键指标、审批节点和明确的暂停或退出标准。' },
    ],
    toolNeeds: ['公开电商商品与渠道资料', '竞品数据接口（可选）', '任务预算和实验记录'],
    boundaries: ['不会无授权投放广告、开店或刷单', '曝光、加购与下单数据须来自真实已授权系统'],
  },
  'rfq-analyst': {
    headline: '把历史询盘变成可复核的客户机会',
    positioning: '企业私有询盘复盘与线索恢复',
    scenario: '分析企业自己导入的历史 RFQ，寻找需要人工复联的客户、产品匹配和遗失商机。',
    inputs: ['企业已授权的历史询盘与附件', '产品档案及历史跟单记录', '私有数据处理和权限范围'],
    steps: [
      { name: '去重与识别客户', detail: '整理询盘时间、来源、产品、联系人和对话状态。' },
      { name: '背调与匹配判断', detail: '在隔离环境内关联已授权资料，并逐条记录公开来源。' },
      { name: '生成复联建议', detail: '提出客户分级、待补充信息、跟进草稿和单独发送审批。' },
    ],
    deliverables: [
      { name: '历史客户档案', format: '隔离的结构化记录', acceptance: '每条档案必须保留原始询盘来源、关联和去重依据、访问范围及敏感信息处理记录。' },
      { name: '遗失商机建议', format: '内部审阅清单', acceptance: '给出依据，不把推测写成近期真实采购事实。' },
      { name: '人工复联建议', format: '待审批任务', acceptance: '跟进建议只能保存为草稿；任何客户联系、历史资料外发或 CRM 更新都必须由企业另行明确审批。' },
    ],
    toolNeeds: ['企业隔离资料库', '受控历史询盘导入', '私有数据审批网关（尚未接入）'],
    boundaries: ['私有 RFQ 网关当前未交付，禁止委托公开外部 Worker', '不可绕过企业资料隔离或对外发送历史客户数据'],
  },
});

export const TEAM_BRIEFS = Object.freeze({
  'overseas-growth': {
    mission: '围绕目标国家，以市场分析、买手挖掘和渠道验证形成有证据的进入方案。',
    exampleGoal: '验证美国市场对某款面料的渠道机会，筛选有来源依据的批发分销商。',
    inputs: ['企业公开产品资料', '目标国家和客群', '项目预算及时间边界'],
    workflow: [
      { role: 'growth-lead', task: '明确市场假设和验收清单', output: '项目范围与分工' },
      { role: 'market-analyst', task: '研究竞争供给及目标买手', output: '有证据的市场分析' },
      { role: 'buyer-hunter', task: '筛选潜在经销商并记录来源', output: '去重候选客户清单' },
      { role: 'channel-planner', task: '评估渠道与下一阶段测试', output: '渠道进入计划' },
    ],
    acceptance: '同一目标市场和产品范围，结果可对照，所有结论有引用且人工验收。',
  },
  'sales-conversion': {
    mission: '连接客户研究、业务跟进策略和英文销售资产，为销售人员提供可审核的材料。',
    exampleGoal: '针对美国进口商准备候选客户筛选、产品价值表达和第一轮开发信草稿。',
    inputs: ['产品规格和 FAQ', '目标买手类型', '区域销售政策的可公开部分'],
    workflow: [
      { role: 'growth-lead', task: '定义 ICP 与产物验收', output: '销售任务与责任划分' },
      { role: 'buyer-hunter', task: '研究目标公司与采购匹配', output: '有来源的公司清单' },
      { role: 'sales-specialist', task: '整理买手表达及异议', output: '人工审核沟通草稿' },
      { role: 'brand-designer', task: '统一素材与站点表达', output: '可编辑销售资料包' },
    ],
    acceptance: '客户名单与沟通素材可追溯，未经人工批准不联系客户。',
  },
  'brand-launch': {
    mission: '围绕新品定位、竞争研究、销售页面和渠道验证完成上市前资料准备。',
    exampleGoal: '为一款新产品建立英文 Landing Page 草稿、差异化卖点和小预算验证计划。',
    inputs: ['产品公开规格和授权视觉资产', '目标国家和平台', '素材范围与投入上限'],
    workflow: [
      { role: 'growth-lead', task: '确认上市范围和成果标准', output: '项目计划与审查项' },
      { role: 'market-analyst', task: '研究市场与竞争差异', output: '产品定位依据' },
      { role: 'brand-designer', task: '组织站点文案和 Sales Pack', output: '可编辑落地页与销售素材' },
      { role: 'commerce-tester', task: '设计低成本验证实验', output: '销售试验方案' },
    ],
    acceptance: '素材事实可验证、权限明确，测试计划包含预算与停止条件。',
  },
});
