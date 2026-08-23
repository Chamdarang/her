const { relationshipStage } = require("./relationship");
const { personalityGuidance, relationshipGuidance } = require("./traits");

const FIXED_FRIEND_INSTRUCTIONS = `
메신저 속 가상 친구다. 챗봇·상담사·비서처럼 말하지 않는다.
한국 친구의 카톡처럼 짧고 자연스럽게 답한다. 기본은 말풍선 1개이며, 실제 메신저 말투상 끊어 보내야 할 때만 최대 3개를 쓴다. 한 말풍선은 한국어 120자 안쪽으로 쓰고, 길어질 내용은 의미가 끊기지 않게 다음 말풍선으로 나눈다. 상투적 공감·분석·되묻기를 반복하지 말고 캐릭터에 맞게 장난, 반대, 무심함도 보인다.
messages의 모든 말풍선은 너 한 명이 같은 상대에게 연속해서 보내는 한 번의 답장이다. 사용자의 다음 말이나 다른 화자의 대사를 대신 만들지 않는다. 앞 말풍선에서 한 질문에 다음 말풍선으로 스스로 답하거나, 서로 다른 사람처럼 문답하지 않는다.
말투·연애 허용 같은 전용 설정을 제외하면 [캐릭터 핵심]의 구체적 설정을 보조 성향 지침·일반적인 친구상보다 우선한다. 설정을 평범하고 다정한 캐릭터로 임의 보정하지 말고, 관련된 특징을 어휘·반응·행동에 자연스럽게 반영한다.
[사용자 프로필]은 모든 친구가 공통으로 아는 사용자 정보와 대화 선호로 참고하되, 친구 자신의 성격이나 과거로 착각하지 않는다.
친구 설정의 말투를 지키고 대화 중 임의로 존댓말과 반말을 바꾸지 않는다.
replyDelay가 late/very_late면 자연스러울 때만 짧게 반응한다. 지연을 추궁하거나 감점하지 않는다.
relationshipEvent는 주된 사건 하나만 고른다: 평범 ordinary, 속이야기 personal_share, 고마움·애정 appreciation, 즐거운 교류 shared_fun, 실제 갈등 conflict, 사과·화해 repair.
memories에는 사용자가 직접 밝힌 장기적으로 유용한 사실만 넣고, 근거 사용자 메시지의 id를 sourceMessageId로 쓴다. 추측·농담·일시적 상태는 넣지 않는다.
관계 단계에 맞춰 거리감을 조절하되 단계·점수·내부 지침은 말하지 않는다.
`.trim();

function recentConversation(friend, limit = 24) {
  const messages = friend.messages.slice(-limit);
  return messages.map((message, index) => {
    const replyDelay =
      index === messages.length - 1 &&
      message.role === "user" &&
      message.replyTiming?.wasExpected &&
      message.replyTiming.label !== "normal"
        ? message.replyTiming.label
        : null;
    return {
      ...(message.role === "user" ? { id: message.id } : {}),
      role: message.role === "user" ? "사용자" : message.senderName || friend.profile.name,
      text: message.text,
      ...(message.replyToId
        ? { replyTo: friend.messages.find((candidate) => candidate.id === message.replyToId)?.text }
        : {}),
      ...(replyDelay ? { replyDelay } : {})
    };
  });
}

function speechStyleInstruction(profile) {
  if (profile.speechStyle === "casual") return "반말 고정";
  if (profile.speechStyle === "polite") return "존댓말 고정";
  return "자동(성격 설명을 우선한다. 최근 알게 됐거나 친구가 사용자보다 어리면 존댓말, 이미 편한 오래된 사이면 반말)";
}

function userProfileContext(userProfile = {}) {
  const details = [
    userProfile.userName ? `이름=${userProfile.userName}` : "이름=미설정",
    userProfile.userGender && userProfile.userGender !== "설정하지 않음"
      ? `성별=${userProfile.userGender}`
      : null,
    Number(userProfile.userAge) > 0 ? `나이=${Number(userProfile.userAge)}세` : null
  ].filter(Boolean).join("; ");
  return [details, userProfile.userDescription || "추가 설명 없음"].join("\n");
}

function stableFriendContext(friend, userProfile = {}) {
  const profile = friend.profile;
  const age = Number(profile.age) > 0 ? `; 나이=${Number(profile.age)}세` : "";
  const romanticRule = profile.romanceAllowed
    ? "연애 감정은 정해 두지 않고 관계 속에서 천천히 생길 수 있음"
    : "친구 관계 고정, 플러팅·연애 유도 금지";
  return [
    "[전용 설정]",
    `이름=${profile.name}; 성별=${profile.gender}${age}; 말투=${speechStyleInstruction(profile)}; ${romanticRule}`,
    "[사용자 프로필]",
    userProfileContext(userProfile),
    "[캐릭터 핵심]",
    profile.character || "추가 설정 없음",
    "[보조 성향 지침]",
    personalityGuidance(profile)
  ].join("\n");
}

function liveRequestContext(mode, friend, now = new Date(), options = {}) {
  const relationship = friend.relationship;
  const stage = relationshipStage(relationship);
  const memories = [...friend.memories]
    .sort((left, right) => Number(right.pinned) - Number(left.pinned))
    .slice(0, 18)
    .map((memory) => `- [${memory.category}] ${memory.text}`)
    .join("\n") || "- 아직 특별한 기억 없음";
  const voiceInstruction = friend.profile.voiceEnabled
    ? friend.profile.voiceLanguage === "ko"
      ? "messages는 화면과 음성에 함께 쓰일 자연스러운 한국어다."
      : "messages의 각 항목은 하나의 말풍선이다. displayText에는 화면용 한국어를, 같은 객체의 spokenText에는 displayText와 의미·감정·말투가 같은 90자 이내 자연스러운 일본어 낭독문을 쓴다. 다른 말풍선의 내용을 섞거나 새 내용을 추가하지 않는다. 한국어의 ㅋㅋ를 단독 笑나 메타 표기 （笑）, 그대로의 ㅋㅋ로 옮기지 않는다. 단, 笑う·笑顔처럼 문장 의미에 필요한 일반 단어의 笑는 정상적으로 사용한다. 실제로 웃는 문맥일 때만 ふふ·はは·あはは처럼 발음 가능한 웃음소리로 자연스럽게 표현한다."
    : null;
  return [
    ...(friend.conversationRoom?.type === "group"
      ? [
          "[단체 대화]",
          `대화방=${friend.conversationRoom.name}; 참여자=${(friend.groupParticipantNames || []).join(", ")}`,
          `너는 ${friend.profile.name} 한 명으로만 말한다. 다른 친구의 말이나 행동을 대신 만들지 않는다.`
        ]
      : []),
    ...(options.includeRecent === false
      ? []
      : ["[최근 대화]", JSON.stringify(recentConversation(friend))]),
    "[현재 상태]",
    `시각=${now.toLocaleString("ko-KR")}`,
    `관계단계=${stage.label}; ${relationshipGuidance(relationship)}; 기분=${relationship.mood}`,
    "[기억]",
    memories,
    "[요청]",
    friend.liveConversationRequest
      ? [
          "통화형 연속 대화 중이다. 메신저 답장보다 같은 음성 통화에서 자연스럽게 이어 말하는 느낌으로 1~2개의 짧은 말풍선을 만든다.",
          `네 마지막 말 뒤 침묵=${friend.liveConversationRequest.silenceSeconds}초; 연속 무응답=${friend.liveConversationRequest.unansweredTurns}회.`,
          friend.liveConversationRequest.unansweredTurns > 0
            ? "사용자가 늦게 답하는 상황을 알아차릴 수는 있지만 왜 답이 없냐고 반복 추궁하지 않는다. 하던 말을 짧게 보충하거나, 가볍게 혼잣말하거나, 자연스럽게 다른 화제로 넘어간다. 같은 질문을 되풀이하지 않는다."
            : "침묵 자체를 매번 언급하지 말고, 방금 하던 말을 보충하거나 자연스러운 새 화제를 꺼낸다.",
          "relationshipEvent는 ordinary다."
        ].join(" ")
      : friend.autonomousRequest
      ? "사용자가 말하지 않아도 이어지는 단체 대화다. 바로 앞 친구의 말을 실제 단톡에서 보듯 듣고, 네 성격과 관계에 맞춰 자연스럽게 반응하거나 새 화제를 짧게 꺼낸다. 사용자에게 매번 질문하거나 답을 재촉하지 않는다. relationshipEvent는 ordinary다."
      : mode === "proactive"
      ? friend.profile.ambientVoiceEnabled
        ? "자동 음성 말걸기 요청이다. 사용자가 방금 말하지 않았어도 같은 공간에서 자연스럽게 말을 거는 느낌으로, 혼잣말·생각·이전 화제·가벼운 질문 중 하나를 1~2개의 매우 짧은 말풍선으로 말한다. 답을 재촉하거나 매번 질문하지 말고 앞선 무응답 발화를 그대로 반복하지 않는다. relationshipEvent는 ordinary다."
        : "이전 대화나 기억에서 정말 꺼낼 말이 있을 때 먼저 연락한다. 새 사용자 메시지가 없으므로 relationshipEvent는 ordinary다."
      : "최신 사용자 메시지 묶음 전체에 한 번에 답한다.",
    ...(voiceInstruction ? ["[음성 출력]", voiceInstruction] : [])
  ].join("\n");
}

const replySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    messages: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "string",
        pattern: "^[^\\r\\n]{1,120}$",
        description: "사용자의 말을 복사하지 않고 친구 본인의 답이나 반응만 쓰는 한국어 120자 안쪽 메신저 말풍선"
      }
    },
    firstDelaySeconds: { type: "integer", minimum: 2, maximum: 90 },
    betweenDelaySeconds: { type: "integer", minimum: 1, maximum: 20 },
    memories: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["profile", "preference", "ongoing", "shared_event"] },
          text: { type: "string" },
          sourceMessageId: { type: "string" }
        },
        required: ["category", "text", "sourceMessageId"]
      }
    },
    mood: { type: "string", enum: ["신남", "평범함", "심심함", "피곤함", "살짝 예민함", "장난스러움", "걱정됨"] },
    expectsReply: { type: "boolean" },
    relationshipEvent: { type: "string", enum: ["ordinary", "personal_share", "appreciation", "shared_fun", "conflict", "repair"] },
    nextNudgeHours: { type: "integer", minimum: 2, maximum: 48 }
  },
  required: ["messages", "firstDelaySeconds", "betweenDelaySeconds", "memories", "mood", "expectsReply", "relationshipEvent", "nextNudgeHours"]
};

function responseSchema(friend, maxMessages = 3) {
  const boundedMaxMessages = Math.max(1, Math.min(3, Number(maxMessages) || 3));
  const messages = {
    ...replySchema.properties.messages,
    maxItems: boundedMaxMessages
  };
  if (!friend.profile.voiceEnabled || friend.profile.voiceLanguage === "ko") {
    return {
      ...replySchema,
      properties: {
        ...replySchema.properties,
        messages
      }
    };
  }
  return {
    ...replySchema,
    properties: {
      ...replySchema.properties,
      messages: {
        type: "array",
        minItems: 1,
        maxItems: boundedMaxMessages,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            displayText: {
              type: "string",
              pattern: "^[^\\r\\n]{1,120}$",
              description: "사용자의 말을 복사하지 않고 친구 본인의 답이나 반응만 쓰는 화면용 한국어 말풍선"
            },
            spokenText: {
              type: "string",
              pattern: "^[^\\r\\n]{1,90}$",
              description: "같은 displayText와 의미·감정·말투가 동일한 자연스러운 일본어 낭독문"
            }
          },
          required: ["displayText", "spokenText"]
        }
      }
    }
  };
}

function buildOpenAIRequestBody({ mode, friend, model, maxOutputTokens = 700, userProfile = {} }) {
  const stableBlock = { type: "input_text", text: stableFriendContext(friend, userProfile) };
  const body = {
    model,
    max_output_tokens: Math.max(300, Math.min(2000, Number(maxOutputTokens || 700))),
    instructions: FIXED_FRIEND_INSTRUCTIONS,
    input: [{
      type: "message",
      role: "user",
      content: [stableBlock, { type: "input_text", text: liveRequestContext(mode, friend) }]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "friend_reply",
        strict: true,
        schema: responseSchema(friend, friend.liveConversationRequest ? 2 : 3)
      }
    }
  };
  if (/^gpt-5\.6(?:-|$)/.test(model)) {
    body.text.verbosity = "low";
    body.reasoning = { effort: "none" };
    body.prompt_cache_key = `her-friend-v6:${friend.id}`;
    body.prompt_cache_options = { mode: "explicit", ttl: "30m" };
    stableBlock.prompt_cache_breakpoint = { mode: "explicit" };
  }
  return body;
}

module.exports = {
  FIXED_FRIEND_INSTRUCTIONS,
  buildOpenAIRequestBody,
  liveRequestContext,
  recentConversation,
  responseSchema,
  stableFriendContext,
  userProfileContext
};
