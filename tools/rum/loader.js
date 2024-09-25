/*
 * This module should handle all of the loading of bundles. Ideally it would work
 * offline, so it should be a service worker. We will migrate code from the main
 * file to here.
 */
import { addCalculatedProps } from './cruncher.js';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DataStoreDB', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('dataStore')) {
        db.createObjectStore('dataStore', { keyPath: 'url' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

async function storeData(url, data) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const transaction = db.transaction(['dataStore'], 'readwrite');
      const objectStore = transaction.objectStore('dataStore');

      const request = objectStore.put({ url, data });

      request.onsuccess = () => {
        console.log(`db:write Data stored successfully at ${url}`);
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('Error storing data:', event.target.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('Error opening database:', error);
    return Promise.resolve(false);
  }
}

async function fetchData(url) {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const transaction = db.transaction(['dataStore'], 'readonly');
      const objectStore = transaction.objectStore('dataStore');

      const request = objectStore.get(url);

      request.onsuccess = (event) => {
        if (event.target.result) {
          console.log(`db:read Data fetched successfully for ${url}:`, event.target.result.data);
          resolve(event.target.result.data);
        } else {
          console.log('db:read No data found for URL:', url);
          resolve(null);
        }
      };

      request.onerror = (event) => {
        console.error('Error fetching data:', event.target.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('Error opening database:', error);
    return Promise.resolve(null);
  }
}

async function getData(apiRequestURL) {
  const data = await fetchData(apiRequestURL);
  if (data) {
    return data;
  }
  const resp = await fetch(apiRequestURL);
  const json = await resp.json();
  await storeData(apiRequestURL, json);
  return json;
}

export default class DataLoader {
  constructor() {
    this.cache = new Map();
    this.API_ENDPOINT = 'https://rum.fastly-aem.page';
    this.DOMAIN = 'www.thinktanked.org';
    this.DOMAIN_KEY = '';
    this.ORG = undefined;
    this.SCOPE = undefined; // unused
  }

  flush() {
    this.cache.clear();
  }

  set domainKey(key) {
    this.DOMAIN_KEY = key;
    this.flush();
  }

  set domain(domain) {
    if (domain.endsWith(':all') && domain !== 'aem.live:all') {
      [this.ORG, this.SCOPE] = domain.split(':');
    } else {
      this.DOMAIN = domain;
    }
    this.flush();
  }

  set apiEndpoint(endpoint) {
    this.API_ENDPOINT = endpoint;
    this.flush();
  }

  apiURL(datePath, hour) {
    const u = new URL(this.API_ENDPOINT);
    u.pathname = [
      ...(this.ORG
        ? ['orgs', this.ORG, 'bundles']
        : ['bundles', this.DOMAIN]
      ),
      datePath,
      hour,
    ]
      .filter((p) => !!p) // remove empty strings
      .join('/');
    u.searchParams.set('domainkey', this.DOMAIN_KEY);
    return u.toString();
  }

  // eslint-disable-next-line class-methods-use-this
  filterByDateRange(data, start, end) {
    if (start || end) {
      const filtered = data.filter((bundle) => {
        const time = new Date(bundle.timeSlot);
        return ((start ? time >= start : true) && (end ? time <= end : true));
      });
      return filtered;
    }
    return data;
  }

  async fetchUTCMonth(utcISOString, start, end) {
    const [date] = utcISOString.split('T');
    const dateSplits = date.split('-');
    dateSplits.pop();
    const monthPath = dateSplits.join('/');
    const apiRequestURL = this.apiURL(monthPath);
    const json = await getData(apiRequestURL);
    const { rumBundles } = json;
    rumBundles.forEach((bundle) => addCalculatedProps(bundle));
    return { date, rumBundles: this.filterByDateRange(rumBundles, start, end) };
  }

  async fetchUTCDay(utcISOString, start, end) {
    const [date] = utcISOString.split('T');
    const datePath = date.split('-').join('/');
    const apiRequestURL = this.apiURL(datePath);
    const json = await getData(apiRequestURL);
    const { rumBundles } = json;
    rumBundles.forEach((bundle) => addCalculatedProps(bundle));
    return { date, rumBundles: this.filterByDateRange(rumBundles, start, end) };
  }

  async fetchUTCHour(utcISOString, start, end) {
    const [date, time] = utcISOString.split('T');
    const datePath = date.split('-').join('/');
    const hour = time.split(':')[0];
    const apiRequestURL = this.apiURL(datePath, hour);
    const json = await getData(apiRequestURL);
    const { rumBundles } = json;
    rumBundles.forEach((bundle) => addCalculatedProps(bundle));
    return { date, hour, rumBundles: this.filterByDateRange(rumBundles, start, end) };
  }

  async fetchLastWeek(endDate) {
    const date = endDate ? new Date(endDate) : new Date();
    const hoursInWeek = 7 * 24;
    const promises = [];
    for (let i = 0; i < hoursInWeek; i += 1) {
      promises.push(this.fetchUTCHour(date.toISOString()));
      date.setTime(date.getTime() - (3600 * 1000));
    }
    const chunks = Promise.all(promises);
    return chunks;
  }

  async fetchPrevious31Days(endDate) {
    const date = endDate ? new Date(endDate) : new Date();
    const days = 31;
    const promises = [];
    for (let i = 0; i < days; i += 1) {
      for (let j = 0; j < 24; j += 1) {
        promises.push(this.fetchUTCHour(date.toISOString()));
        date.setTime(date.getTime() - (3600 * 1000));
      }
      // date.setDate(date.getDate() - 1);
    }
    const chunks = Promise.all(promises);
    return chunks;
  }

  async fetchPrevious12Months(endDate) {
    const date = endDate ? new Date(endDate) : new Date();
    const months = 13; // 13 to include 2 partial months (first and last)
    const promises = [];
    for (let i = 0; i < months; i += 1) {
      promises.push(this.fetchUTCMonth(date.toISOString()));
      date.setMonth(date.getMonth() - 1);
    }
    const chunks = Promise.all(promises);
    return chunks;
  }

  async fetchPeriod(startDate, endDate) {
    const start = new Date(startDate);
    const originalStart = new Date(start);
    const end = endDate ? new Date(endDate) : new Date();

    const diff = end.getTime() - start.getTime();
    if (diff < 0) {
      throw new Error('Start date must be before end date');
    }

    const promises = [];

    if (diff <= (1000 * 60 * 60 * 24 * 7)) {
      // less than a week
      const days = Math.round((diff / (1000 * 60 * 60 * 24))) + 1;

      for (let i = 0; i < days; i += 1) {
        promises.push(this.fetchUTCDay(start.toISOString(), originalStart, end));
        start.setDate(start.getDate() + 1);
      }
    } else if (diff <= (1000 * 60 * 60 * 24 * 31)) {
      // less than a month
      const days = Math.round((diff / (1000 * 60 * 60 * 24))) + 1;

      for (let i = 0; i < days; i += 1) {
        promises.push(this.fetchUTCDay(start.toISOString(), originalStart, end));
        start.setDate(start.getDate() + 1);
      }
    } else {
      const months = Math.round(diff / (1000 * 60 * 60 * 24 * 31)) + 1;

      for (let i = 0; i < months; i += 1) {
        promises.push(this.fetchUTCMonth(start.toISOString(), originalStart, end));
        start.setMonth(start.getMonth() + 1);
      }
    }

    return Promise.all(promises);
  }
}
