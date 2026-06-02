export const DEMO_DATA = {
  meta: {
    url: "https://www.tiktok.com/@casalimpia.mx/video/7390215588421",
    creator: "@casalimpia.mx",
    durationSec: 58,
  },
  subtitles: [
    { t: 0,  es: "Bueno, dejen que les enseñe por qué ya no barro mi casa.",            en: "Okay, let me show you why I don't sweep my house anymore." },
    { t: 4,  es: "Esta aspiradora inalámbrica pesa menos de un kilo y medio.",            en: "This cordless vacuum weighs less than one and a half kilos." },
    { t: 9,  es: "Miren, la levanto con una sola mano, sin esfuerzo.",                    en: "Look, I lift it with one hand, no effort at all." },
    { t: 13, es: "Tiene una succión de veinte mil pascales, súper potente.",             en: "It has twenty thousand pascals of suction, super powerful." },
    { t: 18, es: "Le tiro harina sobre el piso para que vean cómo la absorbe.",          en: "I throw flour on the floor so you can see how it picks it up." },
    { t: 23, es: "¿Ven? Ni rastro. En un pasada quedó limpiecito.",                      en: "See? No trace. One pass and it's spotless." },
    { t: 28, es: "La batería dura cuarenta y cinco minutos con una sola carga.",         en: "The battery lasts forty-five minutes on a single charge." },
    { t: 33, es: "Y trae esta luz LED para que veas el polvo escondido.",                en: "And it comes with this LED light so you see the hidden dust." },
    { t: 38, es: "El cabezal gira para limpiar debajo del sofá sin agacharte.",          en: "The head swivels to clean under the sofa without bending down." },
    { t: 43, es: "Hoy está con cuarenta por ciento de descuento, solo por la transmisión.", en: "Today it's forty percent off, only during the livestream." },
    { t: 49, es: "Le dan al carrito amarillo y se los llevan a este precio.",            en: "Tap the yellow cart and grab it at this price." },
    { t: 54, es: "Yo ya tengo dos en casa. De verdad, cámbienla.",                       en: "I already have two at home. Honestly, make the switch." },
  ],
  analysis: {
    sellingPoints: ["20000Pa 大吸力", "重量 < 1.5kg", "续航 45 分钟", "LED 照明灯头", "可旋转刷头", "直播限时 4 折"],
    scores: [
      { dim: "说服力",   val: 8.7, pct: 87 },
      { dim: "钩子强度", val: 9.2, pct: 92 },
      { dim: "爆款潜力", val: 8.1, pct: 81 },
    ],
    summary: "达人以「我家不再扫地」作为强钩子开场，先制造好奇再给答案。话术围绕痛点（弯腰、扫不干净、续航焦虑）逐条破解，并用「撒面粉一遍吸净」做可视化实证，可信度高。结尾以直播限时 4 折 + 明确的「点黄色购物车」行动指令收口，转化路径清晰。",
    suggestedQuestions: ["这个视频适合投流吗？", "帮我写一条类似脚本", "钩子还能怎么优化？"],
    answers: {
      "这个视频适合投流吗？": "适合。钩子强度 9.2，前 3 秒留存大概率达标，且有撒面粉的可视化实证，完播友好。建议先用 5% 预算小额测试信息流，重点看 3 秒完播与购物车点击率，跑正后再放量。",
      "帮我写一条类似脚本": "开场钩子：「这是我家三年没换过的扫把，今天把它扔了。」→ 痛点：弯腰累、缝隙扫不到 → 实证：撒燕麦片一遍吸净特写 → 参数：吸力/重量/续航三连 → 收口：限时折扣 + 点购物车。全程控制在 50 秒内。",
      "钩子还能怎么优化？": "当前钩子偏「结果前置」，可再加一层反差：把扫把/拖把先入镜再嫌弃地丢开，制造「旧方式 vs 新方式」对比，前 1 秒视觉冲击更强，留存通常能再提升一档。",
    },
    defaultAnswer: "基于当前视频的字幕上下文：这是一条结构完整的家居好物带货视频，强钩子开场、可视化实证、限时折扣收口。如果你有更具体的目标（投流 / 改脚本 / 选品对比），告诉我，我可以给到更针对性的建议。",
  },
} as const;

export type DemoData = typeof DEMO_DATA;
