#include <iostream>
#include <vector>
#include <iterator>
#include <algorithm>
int main() {
    std::vector<int> v{2,4,6}, out;
    std::vector<int>::iterator it=v.begin();
    std::advance(it,1);
    std::cout<<*it<<' '<<*std::prev(v.end())<<' '<<std::distance(v.begin(),v.end())<<' '<<*v.rbegin()<<'\n';
    std::copy(v.begin(),v.end(),std::back_inserter(out));
    for(std::size_t i=0;i<out.size();++i)std::cout<<(i?" ":"")<<out[i];
    std::cout<<'\n';
}
