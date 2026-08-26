import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import BookDetailTabs from '../BookDetailTabs.vue'

const currentPermissions = ref<string[]>([])
const isSuperuser = ref(false)

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (perm: string) => isSuperuser.value || currentPermissions.value.includes(perm),
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn<() => Promise<void>>() }),
}))

describe('BookDetailTabs', () => {
  beforeEach(() => {
    currentPermissions.value = []
    isSuperuser.value = false
  })

  it('hides Workflows tab when user lacks run_workflows permission', () => {
    const wrapper = mount(BookDetailTabs, { props: { bookId: 10 } })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('Workflows')
    expect(labels).toContain('Details')
    expect(labels).toContain('Files')
    expect(labels).toContain('Highlights')
  })

  it('shows Workflows tab when user has run_workflows permission', () => {
    currentPermissions.value = ['run_workflows']
    const wrapper = mount(BookDetailTabs, { props: { bookId: 10 } })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('Workflows')
  })

  it('shows Workflows tab when user is superuser', () => {
    isSuperuser.value = true
    const wrapper = mount(BookDetailTabs, { props: { bookId: 10 } })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toContain('Workflows')
  })
})
