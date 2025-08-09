<template>
  <div class="container">
    <h1>🔥 Social Spark AI</h1>
    <input v-model="field" placeholder="المجال (مثلاً: تسويق)" />
    <input v-model="style" placeholder="الأسلوب (مرح، رسمي)" />
    <input v-model="mood" placeholder="المزاج (مضحك، درامي)" />
    <button @click="generate" :disabled="loading">
      {{ loading ? 'جارٍ التوليد...' : 'ولّعها 🔥' }}
    </button>
    <pre>{{ result }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const field = ref(''), style = ref(''), mood = ref('')
const result = ref(''), loading = ref(false)

async function generate() {
  loading.value = true
  const res = await fetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ field: field.value, style: style.value, mood: mood.value }),
    headers: { 'Content-Type': 'application/json' }
  })
  const data = await res.json()
  result.value = data.post
  loading.value = false
}
</script>
