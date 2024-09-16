function getPersistentToken() {
  return localStorage.getItem('rum-bundler-token') || localStorage.getItem('forms-rum-bundler-token');
}

export default class URLSelector extends HTMLElement {
  constructor() {
    super();
    this.template = `
      <style>
        label {
          display: block;
          margin-right: 8px;
        }

        input {
          width: 80%;
          display: block;
          font: inherit;
          font-size: var(--type-heading-xl-size);
          font-weight: 900;
          letter-spacing: -0.04em;
          border: 0;
        }

        input:disabled {
          background-color: transparent;
          color: black;
        }
        .autocomplete-container {
          display: flex;
          flex-direction: column;
          background-color: #fff;
          max-height: 200px;
          overflow-y: auto;
          width: 100%;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          z-index: 1000;
        }
        .autocomplete-item {
          padding: 10px;
          cursor: pointer;
        }
        .autocomplete-item:hover,
        .autocomplete-item.selected {
          background-color: #f0f0f0;
        }
      </style>
      <label for="url"><img src="https://www.aem.live/favicon.ico"></label>
      <input id="url" type="url">
      <div class="autocomplete-container"></div>
    `;
  }

  async connectedCallback() {
    this.innerHTML = this.template;
    const input = this.querySelector('input');
    input.value = new URL(window.location.href).searchParams.get('domain');
    const img = this.querySelector('img');
    img.src = `https://www.google.com/s2/favicons?domain=${input.value}&sz=64`;

    const autoCompleteContainer = this.querySelector('.autocomplete-container');
    autoCompleteContainer.addEventListener('click', (event) => {
      const { target } = event;
      if (target.classList.contains('autocomplete-item')) {
        input.value = target.textContent;
        autoCompleteContainer.innerHTML = '';
        this.dispatchEvent(new CustomEvent('submit', { detail: input.value }));
      }
    });

    if (!getPersistentToken()) {
      input.disabled = true;
    }

    input.addEventListener('focus', () => {
      input.select();
    });

    let timeoutId;
    const response = await fetch('https://rum-helper.varundua007.workers.dev/domains?limit=500&text=');
    const domainData = (await response.json());
    const domains = domainData.data.map((_) => _.name);
    input.addEventListener('input', async () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        const domain = input.value;
        const autoCompleteList = domains;
        const filteredList = autoCompleteList.filter((item) => item.indexOf(domain) > -1);
        autoCompleteContainer.innerHTML = '';
        filteredList.forEach((item) => {
          const suggestion = document.createElement('div');
          suggestion.classList.add('autocomplete-item');
          suggestion.textContent = item;
          autoCompleteContainer.appendChild(suggestion);
        });
        input.insertAdjacentElement('afterend', autoCompleteContainer);
      }, 500); // Add a delay of 500 milliseconds before making the network call
      this.dispatchEvent(new CustomEvent('change', { detail: input.value }));
    });

    input.addEventListener('keydown', (event) => {
      const autocompleteItems = autoCompleteContainer.querySelectorAll('.autocomplete-item');
      const currentSelectedItem = autoCompleteContainer.querySelector('.selected');

      if (event.key === 'ArrowDown' && autocompleteItems.length > 0) {
        event.preventDefault();
        const nextSelectedItem = currentSelectedItem
          ? currentSelectedItem.nextElementSibling : autocompleteItems[0];
        if (nextSelectedItem) {
          if (currentSelectedItem) currentSelectedItem.classList.remove('selected');
          nextSelectedItem.classList.add('selected');
          input.value = nextSelectedItem.textContent;
        }
      } else if (event.key === 'ArrowUp' && autocompleteItems.length > 0) {
        event.preventDefault();
        const prevSelectedItem = currentSelectedItem
          ? currentSelectedItem.previousElementSibling
          : autocompleteItems[autocompleteItems.length - 1];
        if (prevSelectedItem) {
          if (currentSelectedItem) currentSelectedItem.classList.remove('selected');
          prevSelectedItem.classList.add('selected');
          input.value = prevSelectedItem.textContent;
        }
      }
    });

    input.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        this.dispatchEvent(new CustomEvent('submit', { detail: input.value }));
      }
    });

    input.addEventListener('unfocus', () => {
      this.dispatchEvent(new CustomEvent('submit', { detail: input.value }));
    });

    this.addEventListener('submit', (event) => {
      let domain = event.detail;
      try {
        const entered = new URL(`https://${domain}`);
        domain = entered.hostname;
      } catch (e) {
        // ignore, some domains are not valid URLs
      }
      const goto = new URL(window.location.href);
      // const { searchParams } = new URL(window.location.href);
      // const goto = new URL(window.location.pathname, window.location.origin);
      goto.searchParams.set('domain', domain);
      goto.searchParams.set('view', 'month');
      goto.searchParams.delete('domainkey');
      window.location.href = goto.href;
    });
  }

  get value() {
    return this.querySelector('input').value;
  }
}
