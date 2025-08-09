import { Configuration, OpenAIApi } from 'openai'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const conf = new Configuration({ apiKey: process.env.OPENAI_API_KEY })
  const openai = new OpenAIApi(conf)
  const res = await openai.createChatCompletion({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `اكتب لي بوست عن ${body.field} بأسلوب ${body.style} وبمزاج ${body.mood}` }],
    temperature: 0.8
  })
  return { post: res.data.choices?.[0]?.message?.content || 'فشل التوليد' }
})
