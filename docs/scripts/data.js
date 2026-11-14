// Global providers are available before CFJS starts rendering the shell.
(() => {
  let topics;
  window.docsTopics = () => topics ||= fetch('./data/topics.json').then(response => {
    if (!response.ok) throw new Error('Documentation topics could not load.');
    return response.json();
  }).catch(error => { topics = null; throw error; });
  window.docsNavigation = async () => {
    const groups = [];
    for (const topic of await window.docsTopics()) {
      let group = groups.find(group => group.title === topic.group);
      if (!group) { group = { title: topic.group, topics: [] }; groups.push(group); }
      group.topics.push({ ...topic, href: './' + topic.slug + '.html' });
    }
    return groups;
  };
  window.docsNeighbors = async () => {
    const topics = await window.docsTopics();
    const index = topics.findIndex(topic => topic.slug === document.body.dataset.topic);
    return [topics[index - 1], topics[index + 1]].map((topic, i) => ({
      href: topic ? './' + topic.slug + '.html' : '',
      title: topic?.title || '', label: i ? 'Next' : 'Previous', arrow: i ? '→' : '←'
    }));
  };
})();
