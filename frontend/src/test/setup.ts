// jsdom doesn't implement scrolling; the router calls it after every navigation.
window.scrollTo = () => {};
