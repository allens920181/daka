import { render } from 'preact'
import { App } from './app'
import { boot } from './lib/store'
import './styles.css'

const root = document.getElementById('app')
if (root) {
  render(<App />, root)
  void boot()
}
