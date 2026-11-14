window.independentRows = [{ title: 'Available immediately' }];
window.optionalDetails = () => new Promise(resolve => setTimeout(() => resolve({ description: 'Optional details arrived independently.' }), 600));
