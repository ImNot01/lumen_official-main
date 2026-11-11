import { supabase, supabaseKey, supabaseUrl } from './supabase'

/** Uploads a file to Supabase Storage and reports REAL upload progress (0-100). */
export async function uploadWithProgress(
  bucket: string,
  path: string,
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session expired. Sign in again.')

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', supabaseKey)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      let message = 'Upload failed. Try again.'
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string }
        message = body.message || body.error || message
      } catch {
        /* keep default message */
      }
      reject(new Error(message))
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try again.'))
    xhr.timeout = 120000
    const form = new FormData()
    form.append('cacheControl', '31536000')
    form.append('', blob)
    xhr.send(form)
  })
}
