// 云端 LLM 封装（WorkBuddy Cloud Service，keyless）
// 用于 AI 报告总结和语义搜索精排
//
// 通过官方 npm 包 @tencent-ai/workbuddy-cloud-sdk 接入，
// 配置来自云服务生命周期返回的 publicConfig（endpoint + publishableKey）。

import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';

let cloud: ReturnType<typeof createWorkBuddyCloud> | null = null;
let model: any = null;

export function initCloud() {
  try {
    cloud = createWorkBuddyCloud({
      endpoint: 'https://git-log-manager.app.workbuddy.host',
      oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
      publishableKey: 'wbpk_F4Z555YowbslOl3N50NEAj_UiAq2dYPFaicPwE2Sdh6d8pkHSpSUDNn',
    });
  } catch (e) {
    cloud = null;
  }
}

export async function ensureModel(): Promise<any> {
  if (model) return model;
  if (!cloud) throw new Error('AI 能力未就绪');
  const models = await cloud.llm.models.list();
  if (!models || models.length === 0) throw new Error('暂无可用的 AI 模型');
  model = models.find((m: any) => m.disabled !== true) || models[0];
  if (!model) throw new Error('暂无可用的 AI 模型');
  return model;
}

export function hasCloud(): boolean {
  return !!cloud;
}

// 流式生成：逐块回调
export async function* streamChat(messages: any[]): AsyncGenerator<string> {
  const m = await ensureModel();
  const stream = await cloud!.llm.chat.completions.create({
    model: m.id,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  });
  for await (const chunk of stream) {
    const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (delta && delta.content) yield delta.content;
  }
}

// 一次性返回（SDK 仅支持流式，内部聚合）
export async function chatOnce(messages: any[]): Promise<string> {
  let full = '';
  for await (const chunk of streamChat(messages)) {
    full += chunk;
  }
  return full;
}
